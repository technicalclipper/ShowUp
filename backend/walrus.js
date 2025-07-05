const axios = require('axios');
const fs = require('fs');

// Walrus configuration
const WALRUS_CONFIG = {
    aggregatorUrl: 'https://aggregator.testnet.walrus.atalma.io',
    publisherUrl: 'https://publisher.testnet.walrus.atalma.io'
};

// Function to upload file/image to Walrus
async function uploadFileToWalrus(filePath, options = {}) {
    try {
        const {
            epochs = 5,
            deletable = false,
            sendObjectTo = null
        } = options;

        console.log('🔄 Uploading file to Walrus...');
        console.log(`📁 File: ${filePath}`);
        
        // Read the file
        const fileBuffer = fs.readFileSync(filePath);
        
        // Prepare params
        const params = { epochs };
        if (deletable) params.deletable = true;
        if (sendObjectTo) params.send_object_to = sendObjectTo;
        
        const response = await axios.put(
            `${WALRUS_CONFIG.publisherUrl}/v1/blobs`,
            fileBuffer,
            { 
                headers: { 'Content-Type': 'application/octet-stream' },
                params
            }
        );

        let blobId;
        if (response.data.newlyCreated) {
            blobId = response.data.newlyCreated.blobObject.blobId;
        } else if (response.data.alreadyCertified) {
            blobId = response.data.alreadyCertified.blobId;
        } else {
            throw new Error('Unexpected response from Walrus publisher');
        }

        console.log(`✅ File uploaded successfully!`);
        console.log(`🆔 Blob ID: ${blobId}`);
        console.log(`⏰ Storage duration: ${epochs} epochs`);
        console.log(`🗑️ Deletable: ${deletable}`);
        if (sendObjectTo) console.log(`📤 Sent to: ${sendObjectTo}`);
        
        return blobId;
    } catch (error) {
        console.error('❌ Error uploading file:', error);
        throw error;
    }
}

// Function to retrieve file/image from Walrus
async function retrieveFileFromWalrus(blobId, outputPath = null) {
    try {
        console.log(`🔄 Retrieving file from Walrus...`);
        console.log(`🆔 Blob ID: ${blobId}`);
        
        const response = await axios.get(
            `${WALRUS_CONFIG.aggregatorUrl}/v1/blobs/${blobId}`,
            { 
                responseType: 'arraybuffer',
                headers: { 'Accept': 'application/octet-stream' }
            }
        );

        const fileBuffer = Buffer.from(response.data);
        
        console.log(`✅ File retrieved successfully!`);
        console.log(`📊 File size: ${fileBuffer.length} bytes`);
        
        // Save to file if outputPath is provided
        if (outputPath) {
            fs.writeFileSync(outputPath, fileBuffer);
            console.log(`💾 File saved to: ${outputPath}`);
        }
        
        return fileBuffer;
    } catch (error) {
        console.error('❌ Error retrieving file:', error);
        throw error;
    }
}

// Function to get Walrus URL for a blob ID
function getWalrusUrl(blobId) {
    return `${WALRUS_CONFIG.aggregatorUrl}/v1/blobs/${blobId}`;
}

// Function to store data on Walrus
async function storeDataOnWalrus(data, epochs = 5) {
    try {
        console.log('🔄 Storing data on Walrus...');
        
        const response = await axios.put(
            `${WALRUS_CONFIG.publisherUrl}/v1/blobs`,
            JSON.stringify(data),
            { 
                headers: { 'Content-Type': 'application/json' },
                params: { epochs }
            }
        );

        let blobId;
        if (response.data.newlyCreated) {
            blobId = response.data.newlyCreated.blobObject.blobId;
        } else if (response.data.alreadyCertified) {
            blobId = response.data.alreadyCertified.blobId;
        } else {
            throw new Error('Unexpected response from Walrus publisher');
        }

        console.log(`✅ Data stored successfully!`);
        console.log(`🆔 Blob ID: ${blobId}`);
        console.log(`⏰ Storage duration: ${epochs} epochs`);
        
        return blobId;
    } catch (error) {
        console.error('❌ Error storing data:', error);
        throw error;
    }
}

// Function to retrieve data from Walrus
async function retrieveDataFromWalrus(blobId) {
    try {
        console.log(`🔄 Retrieving data from Walrus...`);
        console.log(`🆔 Blob ID: ${blobId}`);
        
        const response = await axios.get(
            `${WALRUS_CONFIG.aggregatorUrl}/v1/blobs/${blobId}`,
            { headers: { 'Content-Type': 'application/json' } }
        );

        // Handle both string and object responses
        let data;
        if (typeof response.data === 'string') {
            data = JSON.parse(response.data);
        } else {
            data = response.data;
        }
        
        console.log(`✅ Data retrieved successfully!`);
        console.log(`📊 Data size: ${JSON.stringify(data).length} bytes`);
        
        return data;
    } catch (error) {
        console.error('❌ Error retrieving data:', error);
        throw error;
    }
}

module.exports = {
    uploadFileToWalrus,
    retrieveFileFromWalrus,
    getWalrusUrl,
    storeDataOnWalrus,
    retrieveDataFromWalrus
}; 