/* =======================================================
   splash.js
   Logic for the Welcome/Splash page.
   ======================================================= */

$(document).ready(function() {
    // 1. Set the Current Year in footer
    $("#year").text(new Date().getFullYear());

    // 2. Personalize Greeting (Read from Parent)
    try {
        if (window.parent && window.parent.user) {
            const userName = window.parent.user.data.name.split(" ")[0]; // First Name
            $("#welcome-msg").text("Welcome back, " + userName + "!");
        }
    } catch (e) {
        console.log("Guest mode or parent access denied.");
    }
});
