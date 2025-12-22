const fetch = require('node-fetch');
const DescopeSdk = require('@descope/node-sdk').default;

exports.handler = async function(event, context) {
  
  // 1. CORS HEADERS (Required for your Intranet to talk to Netlify)
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Requested-With",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  // 2. PRE-FLIGHT CHECK
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: headers, body: "" };
  }

  try {
    // --- SECURITY GATEWAY START ---
    
    // A. Check if Header exists
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    if (!authHeader) {
      console.warn("Security Block: No Authorization header provided.");
      return { statusCode: 401, headers: headers, body: JSON.stringify({ error: "Unauthorized: Missing Token" }) };
    }

    // B. Extract Token (Remove "Bearer " prefix)
    const token = authHeader.replace(/^Bearer\s+/i, "");

    // C. Initialize Descope SDK
    // Ensure you added DESCOPE_PROJECT_ID to Netlify Environment Variables
    const descopeClient = DescopeSdk({ projectId: process.env.DESCOPE_PROJECT_ID });

    // D. Validate Token
    try {
      // This throws an error if the token is fake, expired, or tampered with
      await descopeClient.validateSession(token);
    } catch (authError) {
      console.error("Security Block: Invalid Token", authError.message);
      return { statusCode: 403, headers: headers, body: JSON.stringify({ error: "Forbidden: Invalid or Expired Token" }) };
    }
    
    // --- SECURITY GATEWAY END (User is Verified) ---


    // 3. ZOHO CONFIGURATION
    const REFRESH_TOKEN = process.env.ZOHO_REFRESH_TOKEN;
    const CLIENT_ID = process.env.ZOHO_CLIENT_ID;
    const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET;
    
    const OWNER_NAME = "information152"; 
    const APP_LINK_NAME = "household-goods-moving-services";
    const REPORT_LINK_NAME = "Current_Bookings";

    // 4. GET ACCESS TOKEN
    const tokenUrl = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${REFRESH_TOKEN}&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=refresh_token`;
    
    const tokenResponse = await fetch(tokenUrl, { method: 'POST' });
    const tokenData = await tokenResponse.json();
    
    if (tokenData.error) {
      console.error("Zoho Token Error:", tokenData.error);
      return { statusCode: 500, headers: headers, body: JSON.stringify({ error: "Backend Connection Error" }) };
    }
    
    const accessToken = tokenData.access_token;

    // 5. FETCH DATA
    console.log(`Fetching from Zoho Report: ${REPORT_LINK_NAME}`);
    const zohoDataUrl = `https://creator.zoho.com/api/v2/${OWNER_NAME}/${APP_LINK_NAME}/report/${REPORT_LINK_NAME}`;
    
    const dataResponse = await fetch(zohoDataUrl, {
      method: 'GET',
      headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });
    
    const zohoJson = await dataResponse.json();

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
