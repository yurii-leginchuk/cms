import { detectWorkflowIntent } from './workflow-intent';

describe('detectWorkflowIntent', () => {
  describe('optimize intent', () => {
    const optimizeCases = [
      'Optimize https://example.com/services/',
      'Please improve this page: https://example.com/about',
      'rewrite the about page',
      'audit /services/seo/',
      'оптимизируй страницу https://example.com/uslugi/',
      'улучши эту страницу',
      'перепиши контент на странице',
      'оптимізуй сторінку послуг',
      'покращи цю сторінку',
      // meta-only rewrites are an optimize intent (Defect D-D)
      'rewrite the meta description for the about page',
      'change the meta title for /services/',
      'update the meta description',
      'измени мета описание для страницы about',
      'поменяй тайтл главной',
      'зміни мета опис сторінки',
      // bare URL implies optimize
      'https://example.com/contact/',
    ];
    it.each(optimizeCases)('classifies %p as optimize', (msg) => {
      expect(detectWorkflowIntent(msg)).toBe('optimize');
    });
  });

  describe('new_page intent', () => {
    const newPageCases = [
      'Create a new page about reputation management',
      'generate a page for our pricing',
      'build a page targeting "seo for lawyers"',
      'write a new page for the homepage',
      'создай страницу про управление репутацией',
      'сгенерируй страницу для услуг',
      'новую страницу про SEO',
      'створи сторінку про послуги',
      'згенеруй сторінку',
    ];
    it.each(newPageCases)('classifies %p as new_page', (msg) => {
      expect(detectWorkflowIntent(msg)).toBe('new_page');
    });
  });

  describe('no workflow intent (analytical / Q&A)', () => {
    const analyticalCases = [
      'How many pages does my site have?',
      'What are my top queries last month?',
      'Which pages are slow?',
      'Do I have orphan pages?',
      'сколько у меня страниц?',
      'какие у меня самые медленные страницы?',
      'show me my quick wins',
    ];
    it.each(analyticalCases)('classifies %p as null', (msg) => {
      expect(detectWorkflowIntent(msg)).toBeNull();
    });
  });

  it('prefers new_page over optimize when both cues present', () => {
    expect(detectWorkflowIntent('create a new page and optimize it')).toBe('new_page');
  });
});
