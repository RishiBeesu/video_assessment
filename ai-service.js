// ai-service.js - Server-side implementation for AI processing
// Add this file to your project and require it in your main server file

const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Configure environment variables in production
// For demo, we'll use placeholders
const AI_API_KEY = process.env.AI_API_KEY || 'your-api-key';
const AI_API_URL = process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions';
const VISION_MODEL = 'gpt-4-vision-preview'; // Or your preferred multimodal model

// Configure temporary storage for images
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Process AI requests
router.post('/process', async (req, res) => {
    try {
        const { text, imageData } = req.body;

        if (!text) {
            return res.status(400).json({
                success: false,
                message: 'Text input is required'
            });
        }

        // Get user session for context
        const userId = req.session.userId || 'anonymous';
        const walkthrough = req.session.walkthrough || {};

        // Process the request differently based on whether image data is included
        let aiResponse;

        if (imageData) {
            // Process image and text together
            aiResponse = await processWithImage(text, imageData, userId, walkthrough);
        } else {
            // Process text only
            aiResponse = await processTextOnly(text, userId, walkthrough);
        }

        res.json({
            success: true,
            response: aiResponse
        });
    } catch (error) {
        console.error('AI processing error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing AI request',
            error: error.message
        });
    }
});

// Process request with both text and image
async function processWithImage(text, imageData, userId, walkthrough) {
    // For demo/development without actual API calls:
    if (process.env.NODE_ENV !== 'production') {
        return generateMockResponse(text, true);
    }

    try {
        // Save image to temporary file
        const imageBuffer = Buffer.from(
            imageData.replace(/^data:image\/\w+;base64,/, ''),
            'base64'
        );
        const imageId = uuidv4();
        const imagePath = path.join(TEMP_DIR, `${imageId}.jpg`);

        fs.writeFileSync(imagePath, imageBuffer);

        // Get current task context if available
        const currentTask = req.session.currentTask || '';

        // Call Vision API
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                messages: [
                    {
                        role: "system",
                        content: generateSystemPrompt(walkthrough, currentTask)
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: text },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
                                }
                            }
                        ]
                    }
                ],
                max_tokens: 300
            })
        });

        const result = await response.json();

        // Clean up temporary file
        fs.unlinkSync(imagePath);

        if (result.choices && result.choices[0] && result.choices[0].message) {
            return result.choices[0].message.content;
        } else {
            console.error('Unexpected API response format:', result);
            return "I couldn't analyze that properly. Please continue with your walkthrough.";
        }
    } catch (error) {
        console.error('Error processing image with AI:', error);
        return "I'm having trouble processing the image. Please continue with your walkthrough.";
    }
}

// Process text-only request
async function processTextOnly(text, userId, walkthrough) {
    // For demo/development without actual API calls:
    if (process.env.NODE_ENV !== 'production') {
        return generateMockResponse(text, false);
    }

    try {
        // Get current task context if available
        const currentTask = req.session.currentTask || '';

        // Call AI API
        const response = await fetch(AI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${AI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini', // Or your preferred model
                messages: [
                    {
                        role: "system",
                        content: generateSystemPrompt(walkthrough, currentTask)
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                max_tokens: 200
            })
        });

        const result = await response.json();

        if (result.choices && result.choices[0] && result.choices[0].message) {
            return result.choices[0].message.content;
        } else {
            console.error('Unexpected API response format:', result);
            return "I couldn't understand that properly. Please continue with your walkthrough.";
        }
    } catch (error) {
        console.error('Error processing text with AI:', error);
        return "I'm having trouble understanding. Please continue with your walkthrough.";
    }
}

// Generate system prompt based on walkthrough context
function generateSystemPrompt(walkthrough, currentTask) {
    let prompt = `You are an AI assistant helping a user complete a home walkthrough for a property inspection. 
Keep your responses brief (1-3 sentences) and focused on helping them capture good video footage.

Your goal is to help them create clear, well-lit videos that show all important aspects of each room.

`;

    // Add task-specific instructions
    if (currentTask) {
        prompt += `They are currently recording the ${currentTask}. `;

        if (currentTask === 'kitchen') {
            prompt += `For kitchens, they should show appliances, countertops, cabinets, sink, and lighting fixtures. `;
        } else if (currentTask === 'livingRoom') {
            prompt += `For living areas, they should show the full space, windows, flooring, and ceiling. `;
        } else if (currentTask === 'bedrooms') {
            prompt += `For bedrooms, they should show the full room dimensions, closets, windows, and any special features. `;
        } else if (currentTask === 'bathrooms') {
            prompt += `For bathrooms, they should show fixtures, shower/tub, toilet, sink, and any signs of water damage. `;
        } else if (currentTask === 'exterior') {
            prompt += `For exterior areas, they should show all sides of the house, the yard, and any special features or concerns. `;
        }
    }

    // Add general guidelines
    prompt += `
General guidelines for good walkthrough videos:
- Move the camera slowly and steadily
- Ensure good lighting
- Capture the entire room, including floors, walls, and ceilings
- Show any special features or potential issues

When viewing an image, evaluate if it shows the necessary elements and provide constructive guidance.
`;

    return prompt;
}

// Generate mock responses for testing/development
function generateMockResponse(text, hasImage) {
    // Simple keyword matching for demo
    const lowerText = text.toLowerCase();

    if (lowerText.includes('lighting') || lowerText.includes('dark') || lowerText.includes('bright')) {
        return "The lighting looks adequate. Try to open curtains or turn on more lights if there are dark areas in the room.";
    }

    if (lowerText.includes('enough') || lowerText.includes('more') || lowerText.includes('sufficient')) {
        return "You're doing well, but try to pan more slowly and make sure to capture all corners of the room.";
    }

    if (lowerText.includes('bathroom') || lowerText.includes('shower') || lowerText.includes('toilet')) {
        return "For the bathroom, make sure to show all fixtures including the shower, toilet, and sink area. Check for any signs of water damage or mold.";
    }

    if (lowerText.includes('kitchen') || lowerText.includes('appliance') || lowerText.includes('counter')) {
        return "In the kitchen, highlight all appliances, countertops, and cabinet space. Open a few cabinets to show storage capacity.";
    }

    if (lowerText.includes('angle') || lowerText.includes('view') || lowerText.includes('camera')) {
        return "Your camera angle looks good. Try to maintain a steady hand as you record and pan slowly across the entire space.";
    }

    if (lowerText.includes('floor') || lowerText.includes('carpet') || lowerText.includes('wood')) {
        return "Make sure to capture the flooring condition throughout the space. Look for any damage, stains, or wear.";
    }

    if (lowerText.includes('hello') || lowerText.includes('hi') || lowerText.includes('hey')) {
        return "Hello! I'm your AI assistant for this walkthrough. Just continue recording and I'll help guide you through the process.";
    }

    // Default responses
    const defaultResponses = [
        "You're doing well. Continue capturing the space and make sure to move slowly.",
        "That looks good. Remember to show the ceiling and floors as well.",
        "You're on the right track. Try to maintain even lighting throughout your recording.",
        "Keep going, you're capturing good details. Make sure to show any special features of this area.",
        "Your walkthrough is coming along nicely. Remember to narrate any important details as you go."
    ];

    // Return random default response
    return defaultResponses[Math.floor(Math.random() * defaultResponses.length)];
}

// Routes
module.exports = router;

// -----------------------------------------------------
// Add to your main server.js file:
// -----------------------------------------------------
/*
const aiService = require('./ai-service');
app.use('/api/ai', aiService);

// Also add this endpoint to handle client-side speech processing
app.post('/api/speech', upload.single('audio'), (req, res) => {
    // In a real implementation, you would:
    // 1. Process the audio file with a speech-to-text service
    // 2. Return the transcribed text
    
    // For demo purposes, we'll just acknowledge receipt
    res.json({
        success: true,
        message: 'Audio received',
        // In production, return: text: "transcribed text here"
    });
});
*/