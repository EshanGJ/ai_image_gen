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

  async generateImage(prompt: string): Promise<any> {
    try {
      console.log('Generating image for prompt:', prompt);
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

      const finalPrompt = `STRICT REQUIREMENT: All labels (A, B, C...) must be UNIQUE. Each identifier must appear EXACTLY ONCE in the diagram. Output only raw image data.\n\n${prompt}`;
      console.log('Final Prompt:', finalPrompt);
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: finalPrompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          // @ts-ignore - imageConfig is a new property in the Gemini 3 Pro Image Preview model
          imageConfig: {
            aspectRatio: '1:1',
            imageSize: '1K',
          },
        } as any,
      });
      const response = await result.response;

      console.log('Gemini Image Response Metadata:', JSON.stringify(response.usageMetadata, null, 2));

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

      const usage = response.usageMetadata;

      return {
        imagePath: `images/${fileName}`,
        usage: {
          promptTokens: usage?.promptTokenCount || 0,
          completionTokens: usage?.candidatesTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0,
        }
      };
    } catch (error) {
      throw new InternalServerErrorException(`Image generation failed: ${error.message}`);
    }
  }

  async generateEssayQuestion(grade: string, subject: string, chapter: string): Promise<any> {
    try {
      const schema = {
        type: SchemaType.OBJECT,
        properties: {
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
          imagePlaceholderPrompt: { type: SchemaType.STRING },
        },
        required: ['questions', 'imagePlaceholderPrompt'],
      } as any;

      const model = this.genAI.getGenerativeModel({
        // model: 'gemini-flash-latest',
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
        
        ACADEMIC LEVEL AND COMPLEXITY:
        The complexity, depth of analysis, and vocabulary must be strictly appropriate for Grade ${grade}. 
        - For lower grades (6-8): Ensure the questions are concise, using simpler language and focusing on fundamental concepts.
        - For higher grades (10-12): The questions should be more comprehensive, requiring deeper analysis, evaluation, and synthesis of information.
        Adjust the total length and detail of the sub-questions accordingly.

        The response must contain:
        1. "questions": An array containing the structured essay question.
           QUESTION GUIDELINES:
           - Generate a COMPREHENSIVE and DETAILED set of questions.
           - The questions MUST be actual interrogative sentences (ending with "?") or clear imperatives (e.g., "Identify...", "Explain...", "Compare...").
           - QUANTITY REQUIREMENT: The "level2" array MUST contain at least 4-5 main sub-questions.
           - DEPTH REQUIREMENT: For each "level2" item, the "level3" array MUST contain at least 2-3 specific sub-questions or parts.
           - At least one sub-question MUST ask the student to identify specific parts of the diagram using placeholders (e.g., "Identify the part labeled A").
           - Further sub-questions should ask about the functions, importance, or processes associated with those specific parts.
           - Ensure the questions follow a logical progression of difficulty.

           The "questions" array should follow this exact structure for each object:
           - questionText: The main setting of the question or the primary high-level question.
           - markingSchema: An array of strings for marking points.
           - continueQuestion: An empty string or relevant continuation text.
           - type: "essay"
           - questionType: "essay"
           - contentType: "text"
           - level2: An array of sub-questions.
             - Each sub-question should have questionText (an actual question), markingSchema (array), continueQuestion (string), and level3 (array).
             - level3 objects should have questionText (an actual sub-question), points (number), markingSchema (array), continueQuestion (string), and level4 (array).

        2. "imagePlaceholderPrompt": A highly descriptive prompt for an image generator.
           CONSISTENCY: Describe a diagram using EXACTLY the same labels (A, B, C...) referenced in the "questions" above.
           STYLE: Professional black and white (B&W) pencil sketch or textbook line drawing.
           NO TEXT: Forbid all characters except single-letter identifiers.
           LABELS & LAYOUT: Use ONLY unique uppercase letters (A, B, C...). Arrange all labels in a vertical column on the left or top side of the diagram, with long, straight leader lines reaching into the illustration. 
           STRICT UNIQUENESS: Every identifier (A, B, C...) MUST appear EXACTLY ONCE. NEVER duplicate a label or use multiple arrows for one letter. This is a technical diagram, and clarity is paramount.
           LANGUAGE: Respond in the language of the questions.
        
        Ensure all question parts EXPLICITLY REFERENCE the sketch defined in "imagePlaceholderPrompt".
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      const usage = response.usageMetadata;

      return {
        ...JSON.parse(response.text()),
        usage: {
          promptTokens: usage?.promptTokenCount || 0,
          completionTokens: usage?.candidatesTokenCount || 0,
          totalTokens: usage?.totalTokenCount || 0,
        }
      };
    } catch (error) {
      throw new InternalServerErrorException(`Essay question generation failed: ${error.message} `);
    }
  }
}
