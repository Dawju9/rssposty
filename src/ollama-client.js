import axios from 'axios';

export class OllamaClient {
  constructor(baseUrl = 'http://localhost:11434', model = 'llama2') {
    this.baseUrl = baseUrl;
    this.model = model;
    this.client = axios.create({
      baseURL: baseUrl,
      timeout: 60000
    });
  }

  async withRetry(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries - 1) {
          const delay = baseDelay * Math.pow(2, attempt);
          console.warn(`Ollama request failed, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  async generate(prompt, options = {}) {
    return this.withRetry(async () => {
      const response = await this.client.post('/api/generate', {
        model: this.model,
        prompt,
        stream: false,
        ...options
      });
      return response.data.response;
    });
  }

  async generateArticle(keywords, style = 'professional') {
    const styleInstructions = {
      professional: 'Write in a professional, informative tone suitable for business audiences.',
      casual: 'Write in a casual, conversational tone that engages readers.',
      technical: 'Write with technical depth and precision for expert audiences.',
      creative: 'Write with creative flair and engaging storytelling.'
    };

    const prompt = `Generate an article based on these keywords: ${keywords.join(', ')}.

${styleInstructions[style] || styleInstructions.professional}

The article should:
1. Be well-structured with clear headings
2. Provide valuable insights about the topics
3. Be engaging and informative
4. Approximately 500-800 words

Write the complete article below:`;

    return await this.generate(prompt);
  }

  async analyzeContent(content, keywords) {
    const prompt = `Analyze this content for relevance to these keywords: ${keywords.join(', ')}

Content:
${content}

Provide a relevance score (0-100) and brief explanation of how well the content matches the keywords.

Format your response as:
Score: [0-100]
Explanation: [brief explanation]`;

    const response = await this.generate(prompt);
    const scoreMatch = response.match(/Score:\s*(\d+)/);
    const explanationMatch = response.match(/Explanation:\s*(.+)/);

    return {
      score: scoreMatch ? parseInt(scoreMatch[1]) : 0,
      explanation: explanationMatch ? explanationMatch[1].trim() : 'No explanation provided'
    };
  }

  async setModel(model) {
    this.model = model;
  }

  async checkConnection() {
    try {
      const response = await this.client.get('/api/tags');
      return response.data;
    } catch (error) {
      throw new Error(`Cannot connect to Ollama: ${error.message}`);
    }
  }
}