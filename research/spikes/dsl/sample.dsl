// sample
Client [icon: monitor, color: blue]
Backend {
  API [icon: server, color: green]
  Worker [icon: cpu]
  DB [icon: database, color: orange]
}
Client > API: HTTPS
API > Worker: enqueue
API > DB: query
Worker > DB: write
Cache [icon: zap, color: yellow]
API <> Cache: get/set
