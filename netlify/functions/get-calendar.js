const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  
  // 1. DEFINE CORS HEADERS
  // The error happened because "Authorization" was missing from this list.
  const headers = {
    "Access-Control-Allow-Origin": "*", // Allows GitHub Pages to connect
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With", // <--- THIS FIXES YOUR ERROR
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // 2. HANDLE "OPTIONS" REQUEST (Pre-flight check)
  // The browser sends this "handshake" first. We must say "OK" and send the headers.
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
    
    // Zoho Configuration
    const OWNER_NAME = "information152"; 
    const APP_LINK_NAME = "household-goods-moving-services";
    const REPORT_LINK_NAME = "Proposal_Contract_Report";

    // 3. GET ACCESS TOKEN
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

    // 4. GET CALENDAR DATA
    const zohoDataUrl = `https://creator.zoho.com/api/v2/${OWNER_NAME}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`;
    console.log("Fetching from Zoho URL:", zohoDataUrl);
    const dataResponse = await fetch(zohoDataUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });
    
    const zohoJson = await dataResponse.json();

    // 5. RETURN SUCCESS
    return {
      statusCode: 200,
      headers: headers,
      body: JSON.stringify({
        data: zohoJson.data || [],
        message: "Success"
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
