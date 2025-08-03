/**
 * Cloudflare Worker to fetch, cache, and serve API data.
 *
 * How it works:
 * 1. It receives a request from the frontend at '/api/data'.
 * 2. It checks a KV (Key-Value) store to see if fresh data was cached today.
 * 3. IF cached data exists and is from today, it returns the cache immediately.
 * 4. IF NOT, it calls the real API using a secret key.
 * 5. It stores the new data and a timestamp in the KV store for future requests.
 * 6. It returns the new data to the frontend.
 *
 * This setup protects your API key and prevents you from hitting API rate limits.
 */

// --- CONFIGURATION ---
// IMPORTANT: Change this URL to your actual API endpoint.
const API_ENDPOINT = 'https://tycoon-2epova.users.cfx.re/status/charges.json';

// This function will be executed for requests to '/api/data'.
export async function onRequest(context) {
    // context contains environment variables, secrets, and the KV namespace.
    const { env } = context;

    // A key for storing our data in the KV cache.
    const CACHE_KEY = 'api_data_cache';

    try {
        // 1. Check for cached data first.
        const cachedResponse = await env.DATA_KV.get(CACHE_KEY, { type: 'json' });

        if (cachedResponse) {
            const cacheDate = new Date(cachedResponse.timestamp).toDateString();
            const todayDate = new Date().toDateString();

            // 2. If the cache is from today, return it.
            if (cacheDate === todayDate) {
                console.log('Returning fresh data from cache.');
                return new Response(JSON.stringify(cachedResponse), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        }
        
        console.log('Cache is stale or missing. Fetching new data from API.');

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
            throw new Error(`API responded with status: ${apiResponse.status}`);
        }
        
        const apiData = await apiResponse.json();

        // IMPORTANT: Adapt this part to match your API's response structure.
        // We assume your API returns an object with a 'data' property which is an array.
        // e.g., { "data": [{ "date": "2024-08-01", "value": 123 }, ...] }
        // If your API just returns the array, you can use: const dataToCache = apiData;
        const dataToCache = apiData.data; 
        
        // --- END REAL API CALL ---


        // 4. Prepare the data for caching and for the client.
        const responsePayload = {
            timestamp: new Date().toISOString(),
            data: dataToCache,
        };

        // 5. Store the new data in the KV cache.
        // The 'expirationTtl' option automatically deletes the key after 2 days (in seconds).
        // This is a safety measure to clean up old cache.
        await env.DATA_KV.put(CACHE_KEY, JSON.stringify(responsePayload), {
            expirationTtl: 60 * 60 * 48 // 48 hours
        });

        console.log('Successfully fetched and cached new data.');

        // 6. Return the new data to the frontend.
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
