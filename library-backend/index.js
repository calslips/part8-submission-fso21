const {
  ApolloServer,
  UserInputError,
  AuthenticationError,
  gql
} = require('apollo-server-express')
const { ApolloServerPluginDrainHttpServer } = require('apollo-server-core')
const express = require('express')
const { createServer } = require('http')
const { execute, subscribe } = require('graphql')
const { SubscriptionServer } = require('subscriptions-transport-ws')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const { PubSub } = require('graphql-subscriptions')
const mongoose = require('mongoose')
const jwt = require('jsonwebtoken')
const DataLoader = require('dataloader')

const Author = require('./models/author')
const Book = require('./models/book')
const User = require('./models/user')
const { MONGODB_URI, JWT_SECRET } = require('./config')

console.log('connecting to:', MONGODB_URI)
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
})
  .then(() =>
    console.log('connected to MongoDB'))
  .catch((error) =>
    console.log('error connecting to MongoDB:', error.message))

mongoose.set('debug', true)

const pubsub = new PubSub()

const typeDefs = gql`
  type Author {
    name: String!
    id: ID!
    born: Int
    bookCount: Int!
  }

  type Book {
    title: String!
    published: Int!
    author: Author!
    id: ID!
    genres: [String!]!
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(
      author: String
      genre: String
    ): [Book!]!
    allAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook(
      title: String!
      published: Int!
      author: String!
      genres: [String!]!
    ): Book
    editAuthor(
      name: String!
      setBornTo: Int!
    ): Author
    createUser(
      username: String!
      favoriteGenre: String!
    ): User
    login(
      username: String!
      password: String!
    ): Token
  }

  type Subscription {
    bookAdded: Book!
  }
`

const resolvers = {
  Author: {
    /* below contains n+1 problem, but updates view & notifies user
    when adding books */
    bookCount: (root) =>
      Book.collection.countDocuments({ author: { $in: [root._id] } })

    /* below solves n+1 problem using dataloader, but view does NOT
    update or notify user when adding books.
    solution to consider: update/clear dataloader cache */
    // bookCount: async (root, args, context) =>
    //   await context.batchBookCount.load(root._id)
  },
  Query: {
    bookCount: async () => await Book.collection.countDocuments(),
    authorCount: async () => await Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      if (args.author && args.genre) {
        let author = await Author.find({ name: args.author })
        return Book
          .find({ author: author[0]._id, genres: { $in: [args.genre] } })
          .populate('author')
      } else if (args.author) {
        let author = await Author.find({ name: args.author })
        return Book
          .find({ author: author[0]._id })
          .populate('author')
      } else if (args.genre) {
        return Book.find({ genres: { $in: [args.genre] } }).populate('author')
      } else {
        return Book.find({}).populate('author')
      }
    },
    allAuthors: async (root, args, context) => await Author.find({}),
    me: async (root, args, context) => await context.currentUser
  },
  Mutation: {
    addBook: async (root, args, context) => {
      let author = await Author.findOne({ name: args.author })
      const newBook = async (newBookAuthor) => {
        const bookToAdd = new Book({ ...args, author })
        await bookToAdd.save()
        return bookToAdd
      }
      const newAuthor = async (newAuthorName) => {
        const authorToAdd = new Author({ name: newAuthorName })
        await authorToAdd.save()
        return authorToAdd
      }
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("failed authentication")
      }

      try {
        if (author) {
          let book = newBook(author)
          pubsub.publish('BOOK_ADDED', { bookAdded: book })
          return book
        }
        author = await newAuthor(args.author)
        let book = newBook(author)
        pubsub.publish('BOOK_ADDED', { bookAdded: book })
        return book
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
    },
    editAuthor: async (root, args, context) => {
      const author = await Author.findOne({ name: args.name })
      const currentUser = context.currentUser

      if (!currentUser) {
        throw new AuthenticationError("failed authentication")
      }

      try {
        if (!author) {
          return null
        }
        author.born = args.setBornTo
        await author.save()
        return author
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
    },
    createUser: async (root, args) => {
      try {
        const newUser = new User({ ...args })
        await newUser.save()
        return newUser
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args
        })
      }
    },
    login: async (root, args) => {
      const validUser = await User.findOne({ username: args.username })

      if (!validUser || args.password !== '123') {
        throw new UserInputError('invalid credentials')
      }
      const tokenPayload = {
        username: validUser.username,
        id: validUser._id
      }
      return { value: jwt.sign(tokenPayload, JWT_SECRET) }
    }
  },
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const startApolloServer = (async () => {
  const app = express()
  const httpServer = createServer(app)
  const schema = makeExecutableSchema({ typeDefs, resolvers })
  const batchBookCount = new DataLoader(async (authorIds) =>
    authorIds.map(async (authorId) =>
      await Book.find({ author: { $in: authorId } })
        .then(books => books.length)
    ),
    {cacheKeyFn: key => key.toString()}
  )

  const subscriptionServer = SubscriptionServer.create({
    schema,
    execute,
    subscribe
  }, {
    server: httpServer,
    path: '/'
  })

  const server = new ApolloServer({
    schema,
    context: async ({ req }) => {
      const auth = req ? req.headers.authorization : null

      if (auth && auth.toLowerCase().startsWith('bearer ')) {
        const decodedToken = jwt.verify(
          auth.split(' ')[1], JWT_SECRET
        )
        const currentUser = await User.findById(decodedToken.id)

        return {
          currentUser,
          batchBookCount,
        }
      }

      return {
        batchBookCount
      }
    },
    plugins: [{
      async serverWillStart() {
        return {
          async drainServer() {
            subscriptionServer.close()
          }
        }
      }
    }]
  })

  await server.start()
  server.applyMiddleware({
    app,
    path: '/'
  })

  await new Promise(resolve => httpServer.listen({ port: 4000 }, resolve))
  console.log(`Server ready at http://localhost:4000${server.graphqlPath}`)
})()
