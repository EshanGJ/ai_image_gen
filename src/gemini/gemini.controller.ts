import { Controller, Post, Body } from '@nestjs/common';
import { GeminiService } from './gemini.service';

@Controller('gemini')
export class GeminiController {
  constructor(private readonly geminiService: GeminiService) {}

  @Post('text')
  async generateText(@Body('prompt') prompt: string) {
    const text = await this.geminiService.generateText(prompt);
    return { text };
  }

  @Post('image')
  async generateImage(@Body('prompt') prompt: string) {
    const imagePath = await this.geminiService.generateImage(prompt);
    return { imagePath };
  }

  @Post('essay-question')
  async generateEssayQuestion(
    @Body('grade') grade: string,
    @Body('subject') subject: string,
    @Body('chapter') chapter: string,
  ) {
    return await this.geminiService.generateEssayQuestion(grade, subject, chapter);
  }
}
