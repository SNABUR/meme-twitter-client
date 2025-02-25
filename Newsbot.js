const { Scraper } = require('agent-twitter-client');
const dotenv = require('dotenv');
const { Cookie } = require('tough-cookie');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { parse } = require('tldts'); // Añade al inicio
const domainsData = require('./domains.json');
const { translate } = require('@vitalets/google-translate-api');


dotenv.config();
const prisma = new PrismaClient();

// Lista actualizada de dominios permitidos
const TRUSTED_DOMAINS = domainsData.domains;

// Añade esto al inicio del código
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDomainWithTLD(url) {
  const parsed = parse(url);
  return parsed.domain || null; // Ej: "feeds2.benzinga.com" → "benzinga.com"
}

function isTrustedSource(url) {
  try {
    const domainWithTLD = getDomainWithTLD(url); // Obtener dominio + TLD

    if (!domainWithTLD) return false; // Si no se pudo extraer, retornar false

    return TRUSTED_DOMAINS.includes(domainWithTLD); // Comparar con la lista confiable
  } catch (error) {
    return false;
  }
}



async function getLatestCryptoNews() {
  try {
    const response = await axios.get(`https://cryptopanic.com/api/v1/posts/?auth_token=${process.env.CRYPTO_PANIC_API_KEY}&public=true`);
    
    if (response.data?.results) {
      const trustedNews = response.data.results
        .filter(news => news.source?.domain && isTrustedSource(news.source.domain)); 
    
      if (trustedNews.length === 0) {
        console.log('🚫 Noticia ignorada (fuente no confiable)',trustedNews);
        return null;
      }
    
      return { 
        title: trustedNews[0].title, // Primera noticia (la más reciente)
        url: trustedNews[0].url 
      };
    }
    
    
    return null;
  } catch (error) {
    console.error("❌ Error obteniendo noticias:", error);
    return null;
  }
}
async function getStoredNewsTitle() {
  try {
    const lastEntry = await prisma.lastTweet.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    console.log("Último título almacenado:", lastEntry?.newsTitle); // 👈 Log para el título
    return lastEntry ? lastEntry.newsTitle : null;
  } catch (error) {
    console.error("❌ Error al obtener el último título almacenado:", error);
    return null;
  }
}

async function getStoredNewsUrl() {
  try {
    const lastEntry = await prisma.lastTweet.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    console.log("Última URL almacenada:", lastEntry?.newsUrl); // 👈 Nuevo log
    return lastEntry ? lastEntry.newsUrl : null;
  } catch (error) {
    console.error("❌ Error al obtener la última URL almacenada:", error);
    return null;
  }
}

async function storeLastTweet(title, url) { // Elimina tweetId de los parámetros
  try {
    await prisma.lastTweet.create({
      data: {
        newsTitle: title,
        newsUrl: url,
      },
    });
    console.log("Última noticia almacenada:", { title, url });
  } catch (error) {
    console.error("❌ Error al almacenar la noticia:", error);
  }
}

async function main() {
  try {
    const scraper = new Scraper();
    let cookiesArray = [];

    // Configuración de cookies
    if (process.env.TWITTER_COOKIES) {
      cookiesArray = JSON.parse(process.env.TWITTER_COOKIES);
      const parsedCookies = cookiesArray.map(cookie => 
        Cookie.parse(`${cookie.name}=${cookie.value}; Domain=${cookie.domain}`)
      ).filter(Boolean);
      await scraper.setCookies(parsedCookies);
    }

    // Login si no hay cookies
    if (cookiesArray.length === 0) {
      await scraper.login(
        process.env.TWITTER_USERNAME,
        process.env.TWITTER_PASSWORD,
        process.env.TWITTER_EMAIL,
        process.env.TWITTER_2FA
      );
    }

    // Lógica principal
    const latestNews = await getLatestCryptoNews();
    
    if (!latestNews) {
      console.log('⏭️ No hay noticias de fuentes confiables');
      return;
    }
    const storedNewsTitle = await getStoredNewsTitle();  // Verificar el título almacenado
    const storedNewsUrl = await getStoredNewsUrl();

    if (latestNews && latestNews.title !== storedNewsTitle && latestNews.url !== storedNewsUrl) {

      let translated;
      try {
          translated = await translate(latestNews.title, { to: 'es' });
      } catch (error) {
          console.error("❌ Error traduciendo:", error);
          return;
      }
  
      if (!translated.text) {
          console.log("🚨 Texto traducido vacío");
          return;
      }
      // Preservar términos en mayúsculas (ej: BTC, NFT)
    const processedText = translated.text.replace(/(\b[A-Z]{3,5}\b)/g, '$$$1');
    const tweetContent = `📰 ${processedText}\n`;
      await scraper.sendTweet(tweetContent);
      await storeLastTweet(latestNews.title, latestNews.url);
      console.log("✅ Tweet enviado y noticia almacenada.");
    } else {
      console.log("⏳ No hay noticias nuevas...");
    }

  } catch (error) {
    console.error("❌ Error en main:", error);
  }
}
// Bucle infinito con intervalo de 1 minuto
async function run() {
  while (true) {
    console.log("\n=== Iniciando verificación ===");
    await main();
    await delay(60000*1); // 60 segundos
  }
}

// Manejar cierre limpio del script
process.on('SIGINT', async () => {
  console.log("\n🔴 Deteniendo el script...");
  await prisma.$disconnect();
  process.exit();
});

// Iniciar el bucle
run();