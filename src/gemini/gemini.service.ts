import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class GeminiService {
  private genAI: GoogleGenerativeAI;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GOOGLE_API_KEY');
    if (!apiKey) {
      throw new Error('GOOGLE_API_KEY is not defined in environment variables');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  async generateText(prompt: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      throw new InternalServerErrorException(`Text generation failed: ${error.message}`);
    }
  }

  async generateImage(prompt: string): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-3-pro-image-preview',
        safetySettings: [
          {
            category: 'HARM_CATEGORY_HARASSMENT' as any,
            threshold: 'BLOCK_NONE' as any,
          },
          {
            category: 'HARM_CATEGORY_HATE_SPEECH' as any,
            threshold: 'BLOCK_NONE' as any,
          },
          {
            category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT' as any,
            threshold: 'BLOCK_NONE' as any,
          },
          {
            category: 'HARM_CATEGORY_DANGEROUS_CONTENT' as any,
            threshold: 'BLOCK_NONE' as any,
          },
        ],
      });

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nIMPORTANT: Output the result ONLY as raw image data. Do not provide a text description or summary.` }] }],
      });
      const response = await result.response;

      if (!response.candidates || response.candidates.length === 0) {
        console.error('Full Response (No Candidates):', JSON.stringify(response, null, 2));
        throw new Error('No candidates found in response');
      }

      // Find the first part with inlineData
      let imageData: string | undefined;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageData = part.inlineData.data;
          break;
        }
      }

      if (!imageData) {
        // Log the entire response for deep debugging
        const fullResponse = JSON.stringify(response, null, 2);
        console.error('Image data extraction failed. Full response:', fullResponse);
        throw new Error(`No image data found in response. See server logs for full structure.`);
      }

      const buffer = Buffer.from(imageData, 'base64');
      
      const fileName = `${crypto.randomUUID()}.png`;
      const publicDir = path.join(process.cwd(), 'public');
      const imagesDir = path.join(publicDir, 'images');

      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
      }

      const filePath = path.join(imagesDir, fileName);
      fs.writeFileSync(filePath, buffer);

      return `images/${fileName}`;
    } catch (error) {
      throw new InternalServerErrorException(`Image generation failed: ${error.message}`);
    }
  }

  async generateEssayQuestion(grade: string, subject: string, chapter: string): Promise<any> {
    try {
      const schema = {
        type: SchemaType.OBJECT,
        properties: {
          question: { type: SchemaType.STRING },
          subQuestions: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
          },
          imagePlaceholderPrompt: { type: SchemaType.STRING },
        },
        required: ['question', 'subQuestions', 'imagePlaceholderPrompt'],
      } as any;

      const model = this.genAI.getGenerativeModel({
        model: 'gemini-flash-latest',
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
        tools: [{ googleSearch: {} } as any],
      });

      const prompt = `
        Generate a structured essay question for a Grade ${grade} student in the subject ${subject}, specifically focusing on the chapter ${chapter}.
        Base the question on the most relevant and accurate information found through Google Search.
        
        CRITICAL INSTRUCTION:
        1. First, create a highly descriptive "imagePlaceholderPrompt" for an image generator. 
           STYLE REQUIREMENT: The image MUST be described as a black and white (B&W) pencil sketch or line drawing. It should look like a diagram or illustration from a textbook or an academic paper. Avoid realistic or colorful descriptions.
        2. Then, generate the "question" and "subQuestions" such that they EXPLICLY REFERENCE the sketch defined in your "imagePlaceholderPrompt".
        3. FINAL STEP FOR imagePlaceholderPrompt: Append the generated "question" and "subQuestions" TO THE END of the "imagePlaceholderPrompt". 
           FORMATTING REQUIREMENT: Precede the questions with the label "QUESTIONS_CONTEXT_DO_NOT_RENDER:" and then surround the questions themselves with triple backticks ( \`\`\` ).
           Example: "...sketch description... QUESTIONS_CONTEXT_DO_NOT_RENDER: \`\`\` <questions here> \`\`\`"
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      return JSON.parse(response.text());
    } catch (error) {
      throw new InternalServerErrorException(`Essay question generation failed: ${error.message}`);
    }
  }
}
