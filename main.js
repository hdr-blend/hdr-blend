// Global object to store the three loaded images
// This keeps track of underexposed, balanced, and overexposed images
let loadedImages = {
    underexposed: null,
    balanced: null,
    overexposed: null
};

// Initialize all event listeners when the page loads
document.addEventListener('DOMContentLoaded', function () {
    // Set up file input handlers for all three image types
    ['underexposed', 'balanced', 'overexposed'].forEach(type => {
        const input = document.getElementById(type);
        // Map the type to the correct preview div ID
        const previewDiv = document.getElementById(`preview-${type === 'underexposed' ? 'under' : type === 'overexposed' ? 'over' : 'balanced'}`);

        // When user selects a file, handle the upload
        input.addEventListener('change', function (e) {
            handleImageUpload(e, type, previewDiv);
        });
    });

    // Set up slider value display updates
    // This updates the number shown next to each slider as you move it
    ['underWeight', 'balancedWeight', 'overWeight', 'gamma', 'contrast', 'saturation'].forEach(id => {
        const slider = document.getElementById(id);
        // Find the corresponding value display span
        const valueSpan = document.getElementById(id.replace('Weight', 'Value').replace('gamma', 'gammaValue').replace('contrast', 'contrastValue').replace('saturation', 'saturationValue'));

        // Update the displayed value in real-time as slider moves
        slider.addEventListener('input', function () {
            valueSpan.textContent = this.value;
        });
    });

    // Set up main processing button
    document.getElementById('blendButton').addEventListener('click', createHDR);

    // Set up download button
    document.getElementById('downloadButton').addEventListener('click', downloadImage);
});

/**
 * Handles image file upload and creates preview
 * @param {Event} event - The file input change event
 * @param {string} type - Type of image (underexposed, balanced, overexposed)
 * @param {HTMLElement} previewDiv - The div to show the preview in
 */
function handleImageUpload(event, type, previewDiv) {
    const file = event.target.files[0];
    if (!file) return; // Exit if no file selected

    // Use FileReader to read the image file as data URL
    const reader = new FileReader();
    reader.onload = function (e) {
        // Create a new Image object to load and validate the file
        const img = new Image();
        img.onload = function () {
            // Store the loaded image in our global object
            loadedImages[type] = img;

            // Create and show preview thumbnail
            previewDiv.innerHTML = `<img src="${e.target.result}" class="preview-image" alt="${type} preview">`;

            // Check if we now have all three images loaded
            checkAllImagesLoaded();
        };
        // Set the image source to the file data - this triggers the onload event
        img.src = e.target.result;
    };
    // Start reading the file as a data URL (base64 encoded)
    reader.readAsDataURL(file);
}

/**
 * Checks if all three images are loaded and enables/disables the blend button
 */
function checkAllImagesLoaded() {
    // Check if every image in our loadedImages object is not null
    const allLoaded = Object.values(loadedImages).every(img => img !== null);

    // Enable/disable the blend button based on whether all images are loaded
    document.getElementById('blendButton').disabled = !allLoaded;

    if (allLoaded) {
        showStatus('All images loaded! Ready to create HDR.', 'success');
    }
}

/**
 * Main HDR processing function - this is where the magic happens!
 */
function createHDR() {
    // Get the canvas where we'll draw the final result
    const canvas = document.getElementById('resultCanvas');
    const ctx = canvas.getContext('2d');

    // Use the balanced image as reference for dimensions
    // All images will be scaled to match this size
    const refImg = loadedImages.balanced;
    canvas.width = refImg.width;
    canvas.height = refImg.height;

    // Get all the user-controlled parameters from the sliders
    const weights = {
        under: parseFloat(document.getElementById('underWeight').value),      // How much underexposed contributes
        balanced: parseFloat(document.getElementById('balancedWeight').value), // How much balanced contributes  
        over: parseFloat(document.getElementById('overWeight').value)          // How much overexposed contributes
    };

    const gamma = parseFloat(document.getElementById('gamma').value);           // Brightness curve adjustment
    const contrast = parseFloat(document.getElementById('contrast').value);     // Contrast enhancement
    const saturation = parseFloat(document.getElementById('saturation').value); // Color vibrancy
    const totalWeight = weights.under + weights.balanced + weights.over;       // Sum for normalization

    showStatus('Processing HDR blend...', 'success');

    // Create temporary canvases to resize all images to the same dimensions
    // This is necessary because the images might be different sizes
    const tempCanvases = {};
    const tempContexts = {};

    Object.keys(loadedImages).forEach(type => {
        // Create a temporary canvas for each image
        tempCanvases[type] = document.createElement('canvas');
        tempCanvases[type].width = canvas.width;   // Match our target size
        tempCanvases[type].height = canvas.height;
        tempContexts[type] = tempCanvases[type].getContext('2d');

        // Draw the original image scaled to fit our target canvas size
        // This handles different image dimensions automatically
        tempContexts[type].drawImage(loadedImages[type], 0, 0, canvas.width, canvas.height);
    });

    // Extract pixel data from each resized image
    // ImageData contains RGBA values for every pixel: [R,G,B,A,R,G,B,A,...]
    const imageData = {
        under: tempContexts.underexposed.getImageData(0, 0, canvas.width, canvas.height),
        balanced: tempContexts.balanced.getImageData(0, 0, canvas.width, canvas.height),
        over: tempContexts.overexposed.getImageData(0, 0, canvas.width, canvas.height)
    };

    // Create a new ImageData object for our result
    const resultData = ctx.createImageData(canvas.width, canvas.height);

    // Enhanced HDR blending algorithm with contrast and saturation
    // Process every pixel (iterate by 4 since each pixel has R,G,B,A values)
    for (let i = 0; i < resultData.data.length; i += 4) {

        // STEP 1: Extract RGB values from each source image for this pixel
        // Note: We skip alpha channel (i+3) since we'll set it to 255 later
        const underR = imageData.under.data[i];         // Red from underexposed
        const underG = imageData.under.data[i + 1];     // Green from underexposed  
        const underB = imageData.under.data[i + 2];     // Blue from underexposed

        const balancedR = imageData.balanced.data[i];     // Red from balanced
        const balancedG = imageData.balanced.data[i + 1]; // Green from balanced
        const balancedB = imageData.balanced.data[i + 2]; // Blue from balanced

        const overR = imageData.over.data[i];         // Red from overexposed
        const overG = imageData.over.data[i + 1];     // Green from overexposed
        const overB = imageData.over.data[i + 2];     // Blue from overexposed

        // STEP 2: Weighted average blending
        // Combine all three exposures using user-defined weights
        // This is the core HDR blending: mix shadows from underexposed, 
        // midtones from balanced, and highlights from overexposed
        let r = (underR * weights.under + balancedR * weights.balanced + overR * weights.over) / totalWeight;
        let g = (underG * weights.under + balancedG * weights.balanced + overG * weights.over) / totalWeight;
        let b = (underB * weights.under + balancedB * weights.balanced + overB * weights.over) / totalWeight;

        // STEP 3: Apply gamma correction (brightness adjustment)
        // Gamma correction adjusts the brightness curve - values < 1 brighten, > 1 darken
        // We work in 0-1 range for gamma, then convert back to 0-255
        if (gamma !== 1.0) {
            r = Math.pow(r / 255, 1 / gamma) * 255;
            g = Math.pow(g / 255, 1 / gamma) * 255;
            b = Math.pow(b / 255, 1 / gamma) * 255;
        }

        // STEP 4: Apply contrast enhancement
        // Contrast works by pushing values away from middle gray (128)
        // Formula: ((value - 0.5) * contrast + 0.5) stretched the range
        if (contrast !== 1.0) {
            r = ((r / 255 - 0.5) * contrast + 0.5) * 255;
            g = ((g / 255 - 0.5) * contrast + 0.5) * 255;
            b = ((b / 255 - 0.5) * contrast + 0.5) * 255;
        }

        // STEP 5: Apply saturation enhancement  
        // Saturation increases color vibrancy by amplifying differences from gray
        // We calculate the average (gray) value, then push colors away from it
        if (saturation !== 1.0) {
            const avg = (r + g + b) / 3; // Calculate gray level for this pixel

            // Push each color channel away from gray by the saturation amount
            // If saturation > 1: colors become more vivid
            // If saturation < 1: colors become more muted/gray
            r = avg + (r - avg) * saturation;
            g = avg + (g - avg) * saturation;
            b = avg + (b - avg) * saturation;
        }

        // STEP 6: Clamp values and store in result
        // Ensure all values are within valid 0-255 range and round to integers
        resultData.data[i] = Math.max(0, Math.min(255, Math.round(r)));     // Red
        resultData.data[i + 1] = Math.max(0, Math.min(255, Math.round(g))); // Green  
        resultData.data[i + 2] = Math.max(0, Math.min(255, Math.round(b))); // Blue
        resultData.data[i + 3] = 255; // Alpha (fully opaque)
    }

    // Draw the processed pixel data to our canvas
    ctx.putImageData(resultData, 0, 0);

    // Show the result canvas and download button
    canvas.style.display = 'block';
    document.getElementById('downloadButton').style.display = 'inline-block';

    showStatus('HDR image created successfully!', 'success');
}

/**
 * Downloads the processed HDR image as a PNG file
 */
function downloadImage() {
    const canvas = document.getElementById('resultCanvas');

    // Create a download link with the canvas data as PNG
    const link = document.createElement('a');
    link.download = 'hdr-blend.png';              // Filename for download
    link.href = canvas.toDataURL();               // Convert canvas to data URL
    link.click();                                 // Trigger download
}

/**
 * Shows status messages to the user
 * @param {string} message - The message to display
 * @param {string} type - 'success' or 'error' for styling
 */
function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;  // Apply CSS class for styling
    statusDiv.style.display = 'block';

    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 3000);
    }
}