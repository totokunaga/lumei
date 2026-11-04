// drizzle/*.sql migrations are imported as strings (babel-plugin-inline-import).
declare module '*.sql' {
  const sql: string;
  export default sql;
}
