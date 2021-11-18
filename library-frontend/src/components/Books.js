import React, { useState } from 'react'
import { useQuery } from '@apollo/client'
import { ALL_BOOKS } from '../queries'

const Books = ({ show }) => {
  const [filter, setFilter] = useState('')
  const result = useQuery(ALL_BOOKS)

  if (!show) {
    return null
  }
  if (result.loading) {
    return <div>loading...</div>
  }
  const books = result.data.allBooks

  const allGenres = books.map(b => b.genres)
    .reduce((previous, current) => previous.concat(current))

  const uniqueGenres = [ ...new Set(allGenres)]

  const changeFilter = (event) => {
    setFilter(event.target.value)
  }

  return (
    <div>
      <h2>books</h2>
      {filter &&
        <p>in genre <strong>{filter}</strong></p>
      }
      <table>
        <tbody>
          <tr>
            <th></th>
            <th>
              author
            </th>
            <th>
              published
            </th>
          </tr>
          {filter
            ? books.filter(b => b.genres.includes(filter)).map(b =>
              <tr key={b.title}>
                <td>{b.title}</td>
                <td>{b.author.name}</td>
                <td>{b.published}</td>
              </tr>
            )
            : books.map(b =>
              <tr key={b.title}>
                <td>{b.title}</td>
                <td>{b.author.name}</td>
                <td>{b.published}</td>
              </tr>
            )
          }
        </tbody>
      </table>
      {uniqueGenres.map(g =>
        <button key={g} value={g} onClick={changeFilter}>{g}</button>
      )}
      <button onClick={changeFilter}>all genres</button>
    </div>
  )
}

export default Books