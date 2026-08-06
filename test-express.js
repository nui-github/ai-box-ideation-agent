const express = require('express');
const app = express();
app.get('/', (req, res) => {
  const code = undefined && undefined.includes('429') ? 429 : 500;
  res.status(code).json({ test: 1 });
});
const server = app.listen(3999, async () => {
    try {
        const resp = await fetch('http://localhost:3999/');
        console.log("Status:", resp.status);
        const text = await resp.text();
        console.log("Response:", text);
    } catch(e) { console.error(e) }
    server.close();
});
