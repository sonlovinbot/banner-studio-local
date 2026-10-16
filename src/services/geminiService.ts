import { GoogleGenAI } from "@google/genai";
import { UploadedImage } from "../types";
import { getGeminiApiKey } from "./storageService";

export const generateBannerWithGemini = async (
  referenceImage: UploadedImage,
  productImage: UploadedImage,
  userPrompt: string,
  brandContent: string,
  aspectRatio: string,
  modelName: string,
  imageSize: string,
  extraReferences: UploadedImage[] = []
): Promise<string> => {
  // Check localStorage first, then .env.local
  const localKey = getGeminiApiKey();
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  const apiKey = localKey || (envKey !== 'your_api_key_here' ? envKey : '');
  if (!apiKey) {
    throw new Error("Google API Key is missing. Please configure it in API Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });

  // Remove data:image/...;base64, prefix for the API
  const cleanRefBase64 = referenceImage.base64.split(',')[1];
  const cleanProdBase64 = productImage.base64.split(',')[1];

  const cleanExtras = extraReferences
    .map(img => ({ mimeType: img.mimeType, data: img.base64.split(',')[1] }))
    .filter(p => !!p.data);

  const extraSection = cleanExtras.length > 0
    ? `
    3. ADDITIONAL REFERENCES (${cleanExtras.length} more image${cleanExtras.length > 1 ? 's' : ''} after the product): treat as supplementary style/composition cues from approved past work or user-supplied tweaks. Blend their aesthetic into the result.`
    : '';

  const promptText = `
    You are an expert graphic designer.
    Task: Create a high-quality professional advertising banner or poster.

    Inputs:
    1. STYLE REFERENCE IMAGE (First image provided): Strictly follow the composition, color palette, lighting, and typography style of this image.
    2. PRODUCT IMAGE (Second image provided): Seamlessly integrate this product into the design. The product is the main focus.${extraSection}

    Brand Messaging/Content: ${brandContent || "No specific brand content provided."}

    Additional User Instructions: ${userPrompt || "Make it look high-end and commercial."}

    Requirements:
    - The output must look like a finished marketing asset.
    - Maintain the product's integrity but blend it into the scene.
    - Do not just copy the reference pixel-for-pixel, but clone its "vibe" and layout structure for the new product.
    - If brand messaging is provided, incorporate it naturally into the design using appropriate typography.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
            { text: promptText },
            {
                inlineData: {
                    mimeType: referenceImage.mimeType,
                    data: cleanRefBase64
                }
            },
            {
                inlineData: {
                    mimeType: productImage.mimeType,
                    data: cleanProdBase64
                }
            },
            ...cleanExtras.map(p => ({ inlineData: { mimeType: p.mimeType, data: p.data } }))
        ]
      },
      config: {
        imageConfig: {
            aspectRatio: aspectRatio as any || "1:1",
            imageSize: imageSize as any || "1K"
        }
      },
    });

    // Extract image from response
    // gemini-3-pro-image-preview returns the image in the candidates content parts
    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
                return `data:image/png;base64,${part.inlineData.data}`;
            }
        }
    }

    throw new Error("No image data found in response");

  } catch (error) {
    console.error("Gemini Generation Error:", error);
    throw error;
  }
};

export const generateUgcWithGemini = async (
  faceImage: UploadedImage,
  fashionImage: UploadedImage,
  productImage: UploadedImage,
  userPrompt: string,
  brandContent: string,
  aspectRatio: string,
  modelName: string,
  imageSize: string
): Promise<string> => {
  const localKey = getGeminiApiKey();
  const envKey = import.meta.env.VITE_GEMINI_API_KEY;
  const apiKey = localKey || (envKey !== 'your_api_key_here' ? envKey : '');
  if (!apiKey) {
    throw new Error("Google API Key is missing. Please configure it in API Settings.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const cleanFace = faceImage.base64.split(',')[1];
  const cleanFashion = fashionImage.base64.split(',')[1];
  const cleanProd = productImage.base64.split(',')[1];

  const promptText = `
You are an expert UGC content creator and photographer.

Inputs (3 images provided in order):
1. FACE REFERENCE — preserve the exact facial features, skin tone, hair, and identity of this person. Do NOT alter the face or generate a new person. The output MUST be recognisably the same individual.
2. FASHION & STYLE REFERENCE — apply the outfit, color palette, lighting, mood, and overall aesthetic of this image.
3. PRODUCT — integrate this product naturally into the scene; the person should be using, wearing, or interacting with it.

Brand context: ${brandContent || "n/a"}
Additional instructions: ${userPrompt || "Candid, natural, social-media-ready UGC."}

Hard rules:
- Identical facial identity to image #1 (no face swaps, no new person).
- Photo-realistic UGC look, natural human proportions, no uncanny artifacts.
- Cohesive lighting between person, outfit, and product.
  `.trim();

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: {
        parts: [
          { text: promptText },
          { inlineData: { mimeType: faceImage.mimeType, data: cleanFace } },
          { inlineData: { mimeType: fashionImage.mimeType, data: cleanFashion } },
          { inlineData: { mimeType: productImage.mimeType, data: cleanProd } },
        ]
      },
      config: {
        imageConfig: {
          aspectRatio: (aspectRatio as any) || "1:1",
          imageSize: (imageSize as any) || "1K",
        }
      },
    });

    if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }

    throw new Error("No image data found in response");
  } catch (error) {
    console.error("Gemini UGC Generation Error:", error);
    throw error;
  }
};
