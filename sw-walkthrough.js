// sw-walkthrough.js - Service Worker for handling offline image uploads

const CACHE_NAME = 'walkthrough-cache-v1';
const UPLOAD_QUEUE_NAME = 'walkthrough-upload-queue';
const SERVER_URL = 'http://localhost:3000/upload-walkthrough-images';

// Files to cache for offline use
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/walkthrough-config.json',
    '/manifest.json',
    // Add other important assets
];

// Install event - cache required assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

// Intercept fetch requests
self.addEventListener('fetch', event => {
    // Skip cross-origin requests
    if (!event.request.url.startsWith(self.location.origin) &&
        !event.request.url.startsWith(SERVER_URL)) {
        return;
    }

    // Special handling for image upload requests
    if (event.request.url.includes('/upload-walkthrough-images')) {
        handleUploadRequest(event);
        return;
    }

    // Standard fetch handling for other requests
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request);
            })
            .catch(() => {
                // Fallback for HTML requests
                if (event.request.headers.get('accept').includes('text/html')) {
                    return caches.match('/offline.html');
                }
            })
    );
});

// Add this function to your frontend code temporarily
function testServerConnection() {
    fetch('http://localhost:3000/walkthroughs')
        .then(response => {
            if (response.ok) {
                console.log('✅ Successfully connected to API server!');
                return response.json();
            }
            throw new Error('Network response was not ok');
        })
        .then(data => {
            console.log('Server response:', data);
        })
        .catch(error => {
            console.error('❌ Error connecting to API server:', error);
        });
}

// Handle image upload requests
function handleUploadRequest(event) {
    // Clone the request to use it more than once
    const requestClone = event.request.clone();

    // Try to send the request normally
    event.respondWith(
        fetch(event.request)
            .then(response => {
                return response;
            })
            .catch(err => {
                // If fetch fails, store request in IndexedDB for later
                return requestClone.json()
                    .then(payload => {
                        console.log('Network request failed, queueing for later upload');
                        return saveImageUploadToQueue(payload)
                            .then(() => {
                                // Return a success response to the app
                                return new Response(JSON.stringify({
                                    success: true,
                                    message: 'Image queued for upload when online',
                                    offline: true
                                }));
                            });
                    });
            })
    );
}

// Save failed uploads to IndexedDB
function saveImageUploadToQueue(payload) {
    return openUploadQueue().then(db => {
        const tx = db.transaction(UPLOAD_QUEUE_NAME, 'readwrite');
        const store = tx.objectStore(UPLOAD_QUEUE_NAME);
        store.add({
            id: Date.now().toString(),
            timestamp: new Date().toISOString(),
            payload: payload
        });
        return tx.complete;
    });
}

// Open IndexedDB queue
function openUploadQueue() {
    return new Promise((resolve, reject) => {
        const openRequest = indexedDB.open('walkthrough-uploads', 1);

        openRequest.onupgradeneeded = event => {
            const db = event.target.result;
            db.createObjectStore(UPLOAD_QUEUE_NAME, { keyPath: 'id' });
        };

        openRequest.onsuccess = event => {
            resolve(event.target.result);
        };

        openRequest.onerror = event => {
            reject(event.target.error);
        };
    });
}

// Process the upload queue when coming online
self.addEventListener('sync', event => {
    if (event.tag === 'walkthrough-sync') {
        event.waitUntil(processUploadQueue());
    }
});

// Process any pending uploads
function processUploadQueue() {
    return openUploadQueue().then(db => {
        const tx = db.transaction(UPLOAD_QUEUE_NAME, 'readonly');
        const store = tx.objectStore(UPLOAD_QUEUE_NAME);
        return store.getAll();
    }).then(items => {
        return Promise.all(items.map(item => {
            return fetch(SERVER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${item.payload.authToken || ''}`
                },
                body: JSON.stringify(item.payload)
            }).then(response => {
                if (response.ok) {
                    // If successful, remove from queue
                    return removeFromQueue(item.id);
                }
            }).catch(err => {
                console.error('Failed to upload queued item:', err);
                // Keep in queue for next sync attempt
            });
        }));
    });
}

// Remove successfully uploaded items from queue
function removeFromQueue(id) {
    return openUploadQueue().then(db => {
        const tx = db.transaction(UPLOAD_QUEUE_NAME, 'readwrite');
        const store = tx.objectStore(UPLOAD_QUEUE_NAME);
        store.delete(id);
        return tx.complete;
    });
}

// Listen for the periodic background sync event
self.addEventListener('periodicsync', event => {
    if (event.tag === 'walkthrough-periodic-sync') {
        event.waitUntil(processUploadQueue());
    }
});

// Register for periodic sync if available
self.registration.periodicSync.register('walkthrough-periodic-sync', {
    minInterval: 15 * 60 * 1000 // Attempt every 15 minutes
}).catch(err => {
    console.log('Periodic Sync could not be registered:', err);
});