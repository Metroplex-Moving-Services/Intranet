/* =======================================================
   login.js
   Handles the Descope Login Widget logic.
   ======================================================= */

const PROJECT_ID = "P2qXQxJA4H4hvSu2AnDB5VjKnh1d";

async function loadLoginWidget() {
    const container = document.getElementById('descope-container');
    
    if(!container) return;

    // Initialize Web Component
    const wc = Descope.wc({ projectId: PROJECT_ID, baseUrl: "https://api.descope.com" });

    // Render Flow
    wc.flow("sign-up-or-in", container, {
        theme: "light",
        onSuccess: (e) => {
            console.log("Login Success:", e.detail.user);
            // Redirect to the main app (Index)
            window.location.href = "index.html"; 
        },
        onError: (e) => {
            console.error("Login Error:", e);
        }
    });
}

document.addEventListener("DOMContentLoaded", loadLoginWidget);
