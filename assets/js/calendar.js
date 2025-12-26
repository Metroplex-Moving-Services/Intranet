/* ============================================================
   CALENDAR.JS
   Handles FullCalendar initialization AND the Refresh Timer.
   ============================================================ */

$(document).ready(function() {

    // --- PART 1: The Refresh Timer (New Feature) ---
    const STALE_THRESHOLD = 60 * 60 * 1000; // 1 Hour
    const startTime = new Date().getTime();

    setInterval(function() {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - startTime;

        if (timeDiff > STALE_THRESHOLD) {
            $("#staleDataBtn").fadeIn();
        }
    }, 60000); // Check every minute


    // --- PART 2: The Calendar Logic (Migrated from HTML) ---
    // NOTE: This is the code that was previously cluttering your HTML.
    
    // Initialize the calendar
    $('#calendar').fullCalendar({
        header: {
            left: 'prev,next today',
            center: 'title',
            right: 'month,agendaWeek,agendaDay'
        },
        defaultView: 'agendaWeek',
        navLinks: true, // can click day/week names to navigate views
        editable: false, // Set to true if you want drag/drop
        eventLimit: true, // allow "more" link when too many events

        // This is where your events come from (ZOHO or JSON)
        // You likely have a big URL or array here in your original file.
        // PASTE YOUR 'events' BLOCK HERE FROM THE ORIGINAL HTML.
        events: function(start, end, timezone, callback) {
            // ... your existing data fetching logic ...
        },

        // Handle clicking an event (The Popup)
        eventClick: function(calEvent, jsEvent, view) {
            // Fill the modal
            $('#modalTitle').html(calEvent.title);
            
            // If you have specific descriptions or data, map them here
            let content = "";
            if(calEvent.description) content += "<p><b>Details:</b> " + calEvent.description + "</p>";
            // ... add other fields ...

            $('#modalBody').html(content);
            
            // Show the modal
            $('#calendarModal').modal();
        }
    });
});
