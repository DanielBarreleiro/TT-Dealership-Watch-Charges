/**
 * Cloudflare Worker to fetch, cache, and serve API data, maintaining a 30-day history.
 *
 * How it works:
 * 1. It receives a request from the frontend at '/api/data'.
 * 2. It checks a KV (Key-Value) store to see if historical data was updated today.
 * 3. IF cached data exists and is from today, it returns the cache immediately.
 * 4. IF NOT, it calls the real API, appends the new value to the history,
 * trims the history to the last 30 days, and generates corresponding dates.
 * 5. It stores the updated historical data and a timestamp in the KV store for future requests.
 * 6. It returns the 30-day historical data (values and dates) to the frontend.
 *
 * This setup protects your API key and prevents you from hitting API rate limits,
 * while also building a historical dataset for your chart.
 */

// --- CONFIGURATION ---
// IMPORTANT: Change this URL to your actual API endpoint.
const API_ENDPOINT = 'https://tycoon-2epova.users.cfx.re/status/charges.json';

// A key for storing our 30-day historical data in the KV cache.
// Changed the key to avoid conflicts with previous data structures.
const CACHE_KEY = 'api_data_cache_30_days_history';

// This function will be executed for requests to '/api/data'.
export async function onRequest(context) {
    // context contains environment variables, secrets, and the KV namespace.
    const { env } = context;

    try {
        // 1. Check for cached historical data first.
        const cachedResponse = await env.DATA_KV.get(CACHE_KEY, { type: 'json' });

        let historicalValues = [];
        let historicalDates = [];
        let lastCachedTimestamp = null;

        if (cachedResponse) {
            // Initialize historical data from cache if it exists
            historicalValues = cachedResponse.historicalValues || [];
            historicalDates = cachedResponse.historicalDates || [];
            lastCachedTimestamp = cachedResponse.timestamp;

            const lastCachedDate = new Date(lastCachedTimestamp).toDateString();
            const todayDate = new Date().toDateString();

            // 2. If the cache is from today, return it immediately.
            if (lastCachedDate === todayDate) {
                console.log('Returning fresh 30-day historical data from cache.');
                return new Response(JSON.stringify(cachedResponse), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }

        console.log('Cache is stale or missing. Fetching new data from API and updating history.');

        // 3. If no fresh cache, fetch from the real API.
        // Get the API key from Cloudflare's secrets.
        const apiKey = env.YOUR_API_KEY;
        if (!apiKey) {
            throw new Error("Secret 'YOUR_API_KEY' is not defined in Cloudflare settings.");
        }

        const apiResponse = await fetch(API_ENDPOINT, {
            headers: {
                // Adjust the authorization header based on your API's requirements.
                'X-Tycoon-Key': `${apiKey}`
            }
        });

        if (!apiResponse.ok) {
            throw new Error(`API responded with status: ${apiResponse.status} - ${await apiResponse.text()}`);
        }

        // Assuming the API returns a simple array like [21939]
        const apiData = await apiResponse.json();
        if (!Array.isArray(apiData) || apiData.length === 0) {
            throw new Error("API response is not an array or is empty. Expected format: [value]");
        }
        const newValue = apiData[0]; // Extract the single value from the array

        // 4. Append the new value to the historical data
        historicalValues.push(newValue);

        // Generate the date for the new value
        const newDate = new Date();
        // Format the date as 'Mon Day' (e.g., 'Jul 20') for chart labels
        historicalDates.push(newDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));

        // 5. Trim the historical data to the last 30 days
        const MAX_DAYS = 30;
        if (historicalValues.length > MAX_DAYS) {
            historicalValues = historicalValues.slice(-MAX_DAYS);
            historicalDates = historicalDates.slice(-MAX_DAYS);
        }

        // 6. Prepare the response payload for caching and the client.
        const responsePayload = {
            timestamp: new Date().toISOString(),
            historicalValues: historicalValues,
            historicalDates: historicalDates,
        };

        // 7. Store the updated historical data in the KV cache.
        // The 'expirationTtl' option automatically deletes the key after 2 days (in seconds).
        // This is a safety measure to clean up old cache.
        await env.DATA_KV.put(CACHE_KEY, JSON.stringify(responsePayload), {
            expirationTtl: 60 * 60 * 48 // 48 hours
        });

        console.log('Successfully fetched, updated history, and cached new data.');

        // 8. Return the new data to the frontend.
        return new Response(JSON.stringify(responsePayload), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error('Worker Error:', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
