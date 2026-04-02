import './SqlByTable.css';

export default function SqlByTable({ data = [] }) {
  if (!data.length) {
    return <div className="sql-by-table-empty">No SQL table data available.</div>;
  }

  const maxTime = data[0]?.totalTime || 1;

  return (
    <div className="sql-by-table">
      <table className="sbt-table">
        <thead>
          <tr>
            <th>Table Name</th>
            <th>SQL Count</th>
            <th>Total Time (s)</th>
            <th>Avg Time (s)</th>
            <th>Operations</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.table} className="sbt-row">
              <td className="sbt-table-name">{row.table}</td>
              <td className="sbt-count">{row.count.toLocaleString()}</td>
              <td className="sbt-time">
                <div className="sbt-bar-wrap">
                  <div
                    className="sbt-bar"
                    style={{ width: `${Math.round((row.totalTime / maxTime) * 100)}%` }}
                  />
                  <span className="sbt-bar-label">{row.totalTime.toFixed(3)}</span>
                </div>
              </td>
              <td className="sbt-avg">{row.avgTime.toFixed(3)}</td>
              <td className="sbt-types">
                {row.sqlTypes.map((t) => (
                  <span key={t} className={`sbt-badge sbt-badge-${t.toLowerCase()}`}>{t}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
