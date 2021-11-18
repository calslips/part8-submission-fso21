import React, { useState } from 'react'
import Select from 'react-select'
import { useQuery, useMutation } from '@apollo/client'
import { ALL_AUTHORS, EDIT_AUTHOR } from '../queries'

const Authors = ({ show, token }) => {
  const [selectedAuthor, setSelectedAuthor] = useState(null)
  const [born, setBorn] = useState('')

  const result = useQuery(ALL_AUTHORS)
  const [editAuthor] = useMutation(EDIT_AUTHOR, {
    refetchQueries: [ALL_AUTHORS]
  })

  if (!show) {
    return null
  }
  if (result.loading) {
    return <div>loading...</div>
  }
  const authors = result.data.allAuthors
  const authorOptions = authors.map((a) => {
    return {
      value: a.name,
      label: a.name
    }
  })

  const updateAuthor = async (event) => {
    event.preventDefault()

    let bornNum = parseInt(born)
    editAuthor({ variables: { name: selectedAuthor.value, setBornTo: bornNum } })

    setBorn('')
  }

  return (
    <div>
      <h2>authors</h2>
      <table>
        <tbody>
          <tr>
            <th></th>
            <th>
              born
            </th>
            <th>
              books
            </th>
          </tr>
          {authors.map(a =>
            <tr key={a.name}>
              <td>{a.name}</td>
              <td>{a.born}</td>
              <td>{a.bookCount}</td>
            </tr>
          )}
        </tbody>
      </table>
      {token &&
      <div>
        <h2>Set birth year</h2>
        <form onSubmit={updateAuthor}>
          <div>
            <Select
              defaultValue={selectedAuthor}
              onChange={setSelectedAuthor}
              options={authorOptions}
            />
          </div>
          <div>
            born <input
              value={born}
              onChange={({ target }) => setBorn(target.value)}
            />
          </div>
          <button type='submit'>update author</button>
        </form>
      </div>
      }
    </div>
  )
}

export default Authors
