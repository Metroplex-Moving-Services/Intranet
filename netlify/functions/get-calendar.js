const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  
  // 1. DEFINE CORS HEADERS
  // We explicitly allow "Authorization" to fix your specific error
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // 2. HANDLE "OPTIONS" REQUEST (Pre-flight check)
  // This is the "handshake" that failed in your error log.
  // We must return status 200 with the headers above.
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: headers,
      body: ""
    };
  }

  try {
    const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
    const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
    const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
    
    // Zoho Config
    const OWNER_NAME = "information152"; 
    const APP_LINK_NAME = "household-goods-moving-services";
    const REPORT_LINK_NAME = "Current_Bookings";

    // 3. GET ACCESS TOKEN FROM ZOHO
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`;
    
    const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      console.error("Zoho Token Error:", tokenData.error);
      return {
        statusCode: 500,
        headers: headers,
        body: JSON.stringify({ error: "Failed to authenticate with Zoho." })
      };
    }
    
    const accessToken = tokenData.access_token;

    // 4. FETCH DATA FROM ZOHO
    const zohoDataUrl = `https://creator.zoho.com/api/v2/${OWNER_NAME}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`;
    
    const dataResponse = await fetch(zohoDataUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });
    
    const zohoJson = await dataResponse.json();

    // 5. RETURN DATA
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        data: zohoJson.data || [],
        message: zohoJson.code ? "Zoho returned code " + zohoJson.code : "Success"
      })
    };

  } catch (error) {
    console.error("Function Error:", error);
    return {
      statusCode: 500,
      headers: headers,
      body: JSON.stringify({ error: "Internal Server Error", details: error.message })
    };
  }
};
