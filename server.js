const { app, initializeApp } = require("./app");

const PORT = Number(process.env.PORT || 3000);

initializeApp()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Servidor online em http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao iniciar o servidor:", error.message);
    process.exit(1);
  });
