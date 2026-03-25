const { app, initializeApp } = require("../app");

module.exports = async (req, res) => {
  try {
    await initializeApp();
    return app(req, res);
  } catch (error) {
    console.error("Falha ao inicializar app na Vercel:", error.message);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Erro interno no servidor." }));
  }
};
