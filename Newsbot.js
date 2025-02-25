const { Scraper } = require('agent-twitter-client');
const dotenv = require('dotenv');
const { Cookie } = require('tough-cookie');
const { PrismaClient } = require('@prisma/client');
const axios = require('axios');
const { parse } = require('tldts');
const domainsData = require('./domains.json');
const { translate } = require('@vitalets/google-translate-api');

dotenv.config();
const prisma = new PrismaClient();

const TRUSTED_DOMAINS = domainsData.domains;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDomainWithTLD(url) {
  const parsed = parse(url);
  return parsed.domain || null;
}

function isTrustedSource(url) {
  try {
    const domainWithTLD = getDomainWithTLD(url);
    if (!domainWithTLD) return false;
    return TRUSTED_DOMAINS.includes(domainWithTLD);
  } catch (error) {
    return false;
  }
}

async function getLatestCryptoNews() {
  try {
    const response = await axios.get(`https://cryptopanic.com/api/v1/posts/?auth_token=${process.env.CRYPTO_PANIC_API_KEY}&public=true`);
    
    if (response.data?.results) {
      const trustedNews = response.data.results.filter(news => news.source?.domain && isTrustedSource(news.source.domain)); 
      if (trustedNews.length === 0) {
        console.log('🚫 Noticia ignorada (fuente no confiable)');
        return null;
      }
      return { 
        title: trustedNews[0].title,
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
    const lastEntry = await prisma.lastTweet.findFirst({ orderBy: { createdAt: 'desc' } });
    console.log("Último título almacenado:", lastEntry?.newsTitle);
    return lastEntry ? lastEntry.newsTitle : null;
  } catch (error) {
    console.error("❌ Error al obtener el último título almacenado:", error);
    return null;
  }
}

async function getStoredNewsUrl() {
  try {
    const lastEntry = await prisma.lastTweet.findFirst({ orderBy: { createdAt: 'desc' } });
    console.log("Última URL almacenada:", lastEntry?.newsUrl);
    return lastEntry ? lastEntry.newsUrl : null;
  } catch (error) {
    console.error("❌ Error al obtener la última URL almacenada:", error);
    return null;
  }
}

async function storeLastTweet(title, url) {
  try {
    await prisma.lastTweet.create({ data: { newsTitle: title, newsUrl: url } });
    console.log("Última noticia almacenada:", { title, url });
  } catch (error) {
    console.error("❌ Error al almacenar la noticia:", error);
  }
}

// Funciones para retweet
async function getStoredRetweetId() {
  try {
    const lastEntry = await prisma.lastRetweet.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    return lastEntry ? lastEntry.tweetId : null;
  } catch (error) {
    console.error("❌ Error obteniendo último retweet almacenado:", error);
    return null;
  }
}

async function storeLastRetweetId(tweetId) {
  try {
    await prisma.lastRetweet.create({
      data: { tweetId },
    });
    console.log("Último retweet almacenado:", tweetId);
  } catch (error) {
    console.error("❌ Error al almacenar el retweet:", error);
  }
}

// Función que monitorea la cuenta y retuitea si hay un tweet nuevo
async function monitorRetweetAccount(scraper) {
  try {
    const monitoredAccount = process.env.TWITTER_MONITORED_ACCOUNT;
    if (!monitoredAccount) {
      console.log("⚠️ No se especificó TWITTER_MONITORED_ACCOUNT en el .env");
      return;
    }
    
    console.log(`🔍 Monitoreando cuenta: ${monitoredAccount}`);
    
    // Usamos la función getTweets que retorna un AsyncGenerator<Tweet>
    const tweetGenerator = scraper.getTweets(monitoredAccount, 1);
    let latestTweet = null;
    // Iterar para obtener el primer tweet
    for await (const tweet of tweetGenerator) {
      latestTweet = tweet;
      break; // Tomamos solo el primer tweet
    }
    
    console.log("📥 Tweet obtenido:", latestTweet);
    
    if (!latestTweet || !latestTweet.id) {
      console.log("❌ No se encontró un tweet válido para retwittear.");
      return;
    }
    
    console.log(`📌 Último tweet detectado: ID ${latestTweet.id}, Texto: ${latestTweet.text}`);
    
    const storedTweetId = await getStoredRetweetId();
    console.log(`💾 Último tweet retuiteado almacenado: ${storedTweetId}`);
    
    if (latestTweet.id !== storedTweetId) {
      console.log(`🔄 Nuevo tweet detectado de ${monitoredAccount}: ${latestTweet.id}`);
      try {
        await scraper.retweet(latestTweet.id);
        console.log(`✅ Retwitteado el tweet ${latestTweet.id}`);
        await storeLastRetweetId(latestTweet.id);
      } catch (retweetError) {
        console.error("❌ Error al hacer retweet:", retweetError);
      }
    } else {
      console.log("⏭️ No hay tweets nuevos para retwittear.");
    }
  } catch (error) {
    console.error("❌ Error en monitorRetweetAccount:", error);
  }
}



async function main() {
  try {
    const scraper = new Scraper();
    let cookiesArray = [];

    if (process.env.TWITTER_COOKIES) {
      cookiesArray = JSON.parse(process.env.TWITTER_COOKIES);
      const parsedCookies = cookiesArray.map(cookie => 
        Cookie.parse(`${cookie.name}=${cookie.value}; Domain=${cookie.domain}`)
      ).filter(Boolean);
      await scraper.setCookies(parsedCookies);
    }

    if (cookiesArray.length === 0) {
      await scraper.login(
        process.env.TWITTER_USERNAME,
        process.env.TWITTER_PASSWORD,
        process.env.TWITTER_EMAIL,
        process.env.TWITTER_2FA
      );
    }

    // Verificar y enviar tweet de noticias (tu lógica existente)
    const latestNews = await getLatestCryptoNews();
    if (!latestNews) {
      console.log('⏭️ No hay noticias de fuentes confiables');
    } else {
      const storedNewsTitle = await getStoredNewsTitle();
      const storedNewsUrl = await getStoredNewsUrl();

      if (latestNews.title !== storedNewsTitle && latestNews.url !== storedNewsUrl) {
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
        const processedText = translated.text.replace(/(\b[A-Z]{3,5}\b)/g, '$$$1');
        const tweetContent = `📰 ${processedText}\n`;
        await scraper.sendTweet(tweetContent);
        await storeLastTweet(latestNews.title, latestNews.url);
        console.log("✅ Tweet enviado y noticia almacenada.");
      } else {
        console.log("⏳ No hay noticias nuevas...");
      }
    }

    // Agregar la verificación para retweet de la cuenta monitoreada
    await monitorRetweetAccount(scraper);

  } catch (error) {
    console.error("❌ Error en main:", error);
  }
}

async function run() {
  while (true) {
    console.log("\n=== Iniciando verificación ===");
    await main();
    await delay(60000); // 60 segundos
  }
}

process.on('SIGINT', async () => {
  console.log("\n🔴 Deteniendo el script...");
  await prisma.$disconnect();
  process.exit();
});

run();
