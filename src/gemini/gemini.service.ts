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
          imagePlaceholderPrompt: { type: SchemaType.STRING },
          questions: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                questionText: { type: SchemaType.STRING },
                markingSchema: {
                  type: SchemaType.ARRAY,
                  items: { type: SchemaType.STRING },
                },
                continueQuestion: { type: SchemaType.STRING },
                type: { type: SchemaType.STRING },
                questionType: { type: SchemaType.STRING },
                contentType: { type: SchemaType.STRING },
                level2: {
                  type: SchemaType.ARRAY,
                  items: {
                    type: SchemaType.OBJECT,
                    properties: {
                      questionText: { type: SchemaType.STRING },
                      markingSchema: {
                        type: SchemaType.ARRAY,
                        items: { type: SchemaType.STRING },
                      },
                      continueQuestion: { type: SchemaType.STRING },
                      level3: {
                        type: SchemaType.ARRAY,
                        items: {
                          type: SchemaType.OBJECT,
                          properties: {
                            questionText: { type: SchemaType.STRING },
                            points: { type: SchemaType.NUMBER },
                            markingSchema: {
                              type: SchemaType.ARRAY,
                              items: { type: SchemaType.STRING },
                            },
                            continueQuestion: { type: SchemaType.STRING },
                            level4: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
                          },
                          required: ['questionText', 'points', 'markingSchema', 'continueQuestion', 'level4'],
                        },
                      },
                    },
                    required: ['questionText', 'markingSchema', 'continueQuestion', 'level3'],
                  },
                },
              },
              required: ['questionText', 'markingSchema', 'continueQuestion', 'type', 'questionType', 'contentType', 'level2'],
            },
          },
        },
        required: ['imagePlaceholderPrompt', 'questions'],
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
        
        The response must contain:
        1. "imagePlaceholderPrompt": A highly descriptive prompt for an image generator.
           STYLE REQUIREMENT: The image MUST be described as a black and white (B&W) pencil sketch or line drawing. It should look like a diagram or illustration from a textbook or an academic paper. Avoid realistic or colorful descriptions.
           FINAL STEP FOR imagePlaceholderPrompt: Append the generated questions TO THE END of the prompt.
           FORMATTING REQUIREMENT: Precede the questions with the label "QUESTIONS_CONTEXT_DO_NOT_RENDER:" and then surround the questions themselves with triple backticks ( \`\`\` ).
        
        2. "questions": An array containing the structured essay question.
           The "questions" array should follow this exact structure for each object:
           - questionText: The main question (e.g., "Discuss the impact of...")
           - markingSchema: An array of strings for marking points.
           - continueQuestion: An empty string or relevant continuation text.
           - type: "essay"
           - questionType: "essay"
           - contentType: "text"
           - level2: An array of sub-questions.
             - Each sub-question should have questionText (without numbering), markingSchema (array), continueQuestion (string), and level3 (array).
             - level3 objects should have questionText, points (number), markingSchema (array), continueQuestion (string), and level4 (array).
        
        Ensure all question parts EXPLICITLY REFERENCE the sketch defined in "imagePlaceholderPrompt".
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      return JSON.parse(response.text());
    } catch (error) {
      throw new InternalServerErrorException(`Essay question generation failed: ${error.message}`);
    }
  }
}
