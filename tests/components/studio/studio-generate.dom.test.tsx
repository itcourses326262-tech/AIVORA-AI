import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, json } from '../generations/support';
import {
  cards,
  generateButton,
  installDomStubs,
  mountStudio,
  promptBox,
  ready,
  resetEnvironment,
  within,
} from './support';

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav, usePathname: () => '/studio' }));

beforeEach(() => {
  installDomStubs();
  nav.push.mockClear();
});
afterEach(resetEnvironment);

async function typePrompt(text = 'A lone lighthouse at sunset') {
  const user = userEvent.setup();
  await user.type(promptBox(), text);
  return user;
}

describe('Studio: generating', () => {
  it('sends the request with an Idempotency-Key, shows the card at once and swaps it for the real one', async () => {
    let answer: (() => void) | undefined;
    const { api } = mountStudio({
      prepare: (fake) =>
        fake.intercept(async (call) => {
          if (call.method === 'POST' && call.path === '/generations') {
            await new Promise<void>((resolve) => {
              answer = resolve;
            });
          }
          return undefined;
        }),
    });
    await ready();
    const user = await typePrompt();
    await user.click(screen.getByRole('radio', { name: 'Aspect ratio 16:9' }));
    await user.click(generateButton());

    // The request is still on its way and the card is already there, queued, not yet cancelable.
    const optimistic = await screen.findByRole('article');
    expect(optimistic).toHaveAttribute('data-status', 'queued');
    expect(optimistic.getAttribute('data-generation-id')).toMatch(/^local-/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(generateButton()).toHaveAttribute('aria-busy', 'true');
    expect(generateButton()).toHaveTextContent('Starting…');

    await act(async () => answer?.());
    await waitFor(() => expect(cards()[0]?.getAttribute('data-generation-id')).toMatch(/^gen_/));
    expect(cards()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

    const [post] = api.callsTo('POST', '/generations');
    expect(post?.body).toEqual({
      tool: 'text-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'A lone lighthouse at sunset',
      params: { aspectRatio: '16:9', count: 1, seed: undefined },
      isPublic: false,
    });
    expect(post?.headers.get('Idempotency-Key')).toMatch(/^[\x21-\x7e]{8,128}$/);
    expect(post?.headers.get('Content-Type')).toBe('application/json');
    // Credits were spent: the balance is read again.
    await waitFor(() => expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0));
    expect(announcement()).toBe('Generation started.');
  });

  it("sends the options of the chosen settings: negative prompt, seed, sharing, count and a video's length", async () => {
    const { api } = mountStudio();
    await ready();
    const user = userEvent.setup();
    await user.type(promptBox(), 'Waves');
    await user.click(screen.getByRole('tab', { name: 'Text to video' }));
    await user.click(screen.getByRole('radio', { name: '5 sec' }));
    await user.click(screen.getByRole('radio', { name: '720p' }));
    await user.click(screen.getByRole('switch', { name: /Share to Explore/ }));
    await user.click(screen.getByRole('button', { name: 'Advanced options' }));
    await user.type(screen.getByRole('textbox', { name: /Seed/ }), '42');
    await user.click(generateButton());
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect(api.callsTo('POST', '/generations')[0]?.body).toEqual({
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'Waves',
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '720p', seed: 42 },
      isPublic: true,
    });
  });

  it('submits with Ctrl+Enter and with Cmd+Enter, and a plain Enter only adds a line', async () => {
    const { api } = mountStudio();
    await ready();
    const user = await typePrompt('Hello');
    await user.keyboard('{Enter}');
    expect(promptBox()).toHaveValue('Hello\n');
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);

    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(1));
    expect((api.callsTo('POST', '/generations')[0]?.body as { prompt: string }).prompt).toBe(
      'Hello',
    );
    // The first request has to be answered before another can start.
    await waitFor(() => expect(cards()[0]?.getAttribute('data-generation-id')).toMatch(/^gen_/));

    // Focus went to the new card; back to the prompt for the next one.
    await user.click(promptBox());
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(api.callsTo('POST', '/generations')).toHaveLength(2));
  });

  it('moves focus to the new card after a keyboard submit, and leaves it alone after a click', async () => {
    mountStudio();
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(1));
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(generateButton()).toHaveFocus();

    await user.click(promptBox());
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(cards()).toHaveLength(2));
    await waitFor(() => expect(cards()[0]).toHaveFocus());
  });

  it('does not send a blank prompt: it says so, puts the cursor in the box and clears the message on typing', async () => {
    const { api } = mountStudio();
    await ready();
    const user = userEvent.setup();
    await user.click(generateButton());
    expect(await screen.findByText('Write a prompt to continue.')).toBeInTheDocument();
    expect(promptBox()).toHaveFocus();
    expect(promptBox()).toHaveAttribute('aria-invalid', 'true');
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
    // The inline message is an alert already: the live region must not say it a second time.
    expect(announcement()).toBe('');
    await user.type(promptBox(), 'x');
    expect(screen.queryByText('Write a prompt to continue.')).not.toBeInTheDocument();
  });

  it('flags a prompt that is too long while it is typed, and does not send it', async () => {
    const { api } = mountStudio();
    await ready();
    fireEvent.change(promptBox(), { target: { value: 'x'.repeat(2001) } });
    expect(
      screen.getByText('This prompt is too long for this model (up to 2000 characters).'),
    ).toBeInTheDocument();
    expect(screen.getByText('2,001 / 2,000')).toBeInTheDocument();
    await userEvent.setup().click(generateButton());
    expect(api.callsTo('POST', '/generations')).toHaveLength(0);
    fireEvent.change(promptBox(), { target: { value: 'x'.repeat(2000) } });
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
  });

  it('counts characters the way the server does', async () => {
    mountStudio();
    await ready();
    fireEvent.change(promptBox(), { target: { value: '😀'.repeat(5) } });
    expect(screen.getByText('5 / 2,000')).toBeInTheDocument();
  });

  it('sends a second click once the first has finished, never two at the same time', async () => {
    let answer: (() => void) | undefined;
    const { api } = mountStudio({
      prepare: (fake) =>
        fake.intercept(async (call) => {
          if (call.method === 'POST' && call.path === '/generations') {
            await new Promise<void>((resolve) => {
              answer = resolve;
            });
          }
          return undefined;
        }),
    });
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    await user.click(generateButton());
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(api.callsTo('POST', '/generations')).toHaveLength(1);
    await act(async () => answer?.());
    await waitFor(() => expect(generateButton()).not.toHaveAttribute('aria-busy'));
  });
});

describe('Studio: the Idempotency-Key', () => {
  const posts = (api: ReturnType<typeof mountStudio>['api']) =>
    api.callsTo('POST', '/generations').map((call) => call.headers.get('Idempotency-Key'));

  it('uses a new key for every click that went through', async () => {
    const { api } = mountStudio();
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(1));
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(2));
    const [first, second] = posts(api);
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('keeps the key when the outcome is unknown, so pressing Generate again cannot charge twice', async () => {
    let offline = true;
    const { api } = mountStudio({
      prepare: (fake) =>
        fake.intercept((call) => {
          if (offline && call.method === 'POST' && call.path === '/generations') {
            throw new TypeError('Failed to fetch');
          }
          return undefined;
        }),
    });
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    expect(
      await screen.findByText("We can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
    // The card that was shown is gone and the form is as it was.
    expect(cards()).toHaveLength(0);
    expect(promptBox()).toHaveValue('A lone lighthouse at sunset');
    expect(generateButton()).toBeEnabled();

    offline = false;
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(1));
    const [first, retry] = posts(api);
    expect(retry).toBe(first);
  });

  it('keeps the key after a server failure too, and drops it when the request changes', async () => {
    let failures = 1;
    const { api } = mountStudio({
      prepare: (fake) =>
        fake.intercept((call) =>
          call.method === 'POST' && call.path === '/generations' && failures-- > 0
            ? apiError(500, 'internal')
            : undefined,
        ),
    });
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    await screen.findByText('Something went wrong on our side. Please try again.');

    // A different request must not reuse the key (the server would answer 409).
    await user.type(promptBox(), ' with clouds');
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(1));
    const [first, second] = posts(api);
    expect(second).not.toBe(first);
  });

  it('starts afresh after a definite refusal', async () => {
    let refuse = true;
    const { api } = mountStudio({
      prepare: (fake) =>
        fake.intercept((call) => {
          if (refuse && call.method === 'POST' && call.path === '/generations') {
            refuse = false;
            return apiError(422, 'moderation_blocked');
          }
          return undefined;
        }),
    });
    await ready();
    const user = await typePrompt();
    await user.click(generateButton());
    await screen.findAllByText(/content policy/);
    await user.click(generateButton());
    await waitFor(() => expect(cards()).toHaveLength(1));
    const [first, second] = posts(api);
    expect(second).not.toBe(first);
  });
});

describe('Studio: what a refused request says', () => {
  async function refuse(response: Response, prompt = 'A lone lighthouse at sunset') {
    const view = mountStudio({
      prepare: (fake) =>
        fake.intercept((call) =>
          call.method === 'POST' && call.path === '/generations' ? response : undefined,
        ),
    });
    await ready();
    const user = await typePrompt(prompt);
    await user.click(generateButton());
    // Whatever the reason, nothing is left half done.
    await waitFor(() => expect(generateButton()).not.toHaveAttribute('aria-busy'));
    expect(cards()).toHaveLength(0);
    expect(promptBox()).toHaveValue(prompt);
    return { ...view, user };
  }

  it('marks the prompt when moderation declines it, and puts the cursor there', async () => {
    await refuse(apiError(422, 'moderation_blocked', { category: 'violence' }));
    expect(
      await screen.findAllByText(/can't be used because it goes against our content policy/),
    ).not.toHaveLength(0);
    expect(promptBox()).toHaveAttribute('aria-invalid', 'true');
    expect(promptBox()).toHaveFocus();
    expect(screen.getByText('We could not start the generation')).toBeInTheDocument();
  });

  it('offers to get credits when the account is short, and refreshes the balance', async () => {
    const { api, user } = await refuse(
      apiError(402, 'insufficient_credits', { required: 1, balance: 0 }),
    );
    expect(await screen.findByText("You don't have enough credits for this.")).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET', '/auth/me').length).toBeGreaterThan(0));
    const toast = screen
      .getByText('We could not start the generation')
      .closest('[data-variant]') as HTMLElement;
    await user.click(within(toast).getByRole('button', { name: 'Get credits' }));
    expect(nav.push).toHaveBeenCalledWith('/pricing');
  });

  it('says when to try again after a rate limit', async () => {
    await refuse(apiError(429, 'rate_limited', { retryAfterSec: 7 }));
    expect(await screen.findByText('Too many requests. Try again in 7 sec.')).toBeInTheDocument();
  });

  it('falls back to the general text for a rate limit without a hint', async () => {
    await refuse(apiError(429, 'rate_limited'));
    expect(
      await screen.findByText('Too many requests. Please wait a moment and try again.'),
    ).toBeInTheDocument();
  });

  it('says the limit of running generations is reached', async () => {
    await refuse(apiError(429, 'too_many_active', { limit: 4 }));
    expect(
      await screen.findByText(
        'You already have the maximum number of generations running. Wait for one to finish.',
      ),
    ).toBeInTheDocument();
  });

  it('says the service is busy, with the wait the server names', async () => {
    await refuse(apiError(503, 'service_busy', { retryAfterSec: 90 }));
    expect(
      await screen.findByText('The generation service is busy. Please try again in 90 sec.'),
    ).toBeInTheDocument();
  });

  it("says a provider failure is the service being busy, not the user's fault", async () => {
    await refuse(apiError(502, 'provider_error'));
    expect(
      await screen.findByText('The generation service is busy. Please try again in a moment.'),
    ).toBeInTheDocument();
  });

  it("asks an unconfirmed email to be confirmed, with the server's own wording from the errors", async () => {
    await refuse(apiError(403, 'email_not_verified'));
    expect(
      await screen.findByText(/Confirm your email address to create generations/),
    ).toBeInTheDocument();
  });

  it('shows an unexpected failure as the general error', async () => {
    await refuse(apiError(500, 'internal'));
    expect(
      await screen.findByText('Something went wrong on our side. Please try again.'),
    ).toBeInTheDocument();
  });

  it('shows an answer that is not the API envelope as an unexpected response', async () => {
    await refuse(new Response('<html>oops</html>', { status: 200 }));
    expect(
      await screen.findByText('The server sent an unexpected response. Please try again.'),
    ).toBeInTheDocument();
  });

  it('sends a signed-out user to log in and back to the same address', async () => {
    window.history.replaceState(null, '', '/studio?tool=text-to-image');
    await refuse(apiError(401, 'unauthorized'));
    expect(
      await screen.findByText('Your session has expired. Log in to continue.'),
    ).toBeInTheDocument();
    expect(nav.push).toHaveBeenCalledTimes(1);
    const target = nav.push.mock.calls[0]?.[0] as string;
    expect(target.startsWith('/login?next=')).toBe(true);
    expect(decodeURIComponent(target)).toContain('/studio?tool=text-to-image');
  });

  it('reloads the models when the chosen one is not configured on the server', async () => {
    const { api } = await refuse(
      apiError(409, 'conflict', { reason: 'model_unavailable', modelId: 'aivore-demo-image' }),
    );
    expect(
      await screen.findByText(
        'That model is not available on this server right now. Choose another one.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(api.callsTo('GET', '/models').length).toBeGreaterThan(1));
  });

  it('shows the refused field next to its control, and clears it when the user changes it', async () => {
    const { user } = await refuse(
      apiError(422, 'validation_failed', {
        issues: [{ path: 'params.aspectRatio', message: 'aspectRatio must be one of 1:1' }],
      }),
    );
    expect(
      await screen.findByText('This model does not offer that aspect ratio.'),
    ).toBeInTheDocument();
    // The sentence is ours, not the English one of the API.
    expect(screen.queryByText(/must be one of/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Aspect ratio 4:3' }));
    expect(
      screen.queryByText('This model does not offer that aspect ratio.'),
    ).not.toBeInTheDocument();
  });

  it('shows a refused prompt under the prompt', async () => {
    await refuse(
      apiError(422, 'validation_failed', {
        issues: [{ path: 'prompt', message: 'prompt must not be empty' }],
      }),
    );
    expect(await screen.findAllByText('Check the prompt for this model.')).not.toHaveLength(0);
    expect(promptBox()).toHaveAttribute('aria-invalid', 'true');
  });

  it('speaks Arabic in every one of these', async () => {
    mountStudio({
      locale: 'ar',
      prepare: (fake) =>
        fake.intercept((call) =>
          call.method === 'POST' && call.path === '/generations'
            ? apiError(429, 'rate_limited', { retryAfterSec: 7 })
            : undefined,
        ),
    });
    await ready();
    const user = userEvent.setup();
    await user.type(promptBox(), 'منارة');
    await user.click(generateButton());
    expect(
      await screen.findByText('عدد الطلبات كبير جدًا. حاول مرة أخرى بعد ٧ ث.'),
    ).toBeInTheDocument();
    expect(screen.getByText('تعذّر بدء عملية الإنشاء')).toBeInTheDocument();
  });
});

describe('Studio: the prompt helpers', () => {
  it('improves the prompt, says what was done, and Undo brings the original back with focus on the text', async () => {
    const { api } = mountStudio({
      enhance: (prompt) => ({ prompt: `${prompt}, cinematic lighting, 85mm`, translated: true }),
    });
    await ready();
    const user = await typePrompt('a cat');
    await user.click(screen.getByRole('button', { name: 'Enhance' }));
    await waitFor(() => expect(promptBox()).toHaveValue('a cat, cinematic lighting, 85mm'));
    expect(api.callsTo('POST', '/prompt/enhance')[0]?.body).toEqual({
      prompt: 'a cat',
      kind: 'image',
      locale: 'en',
    });
    expect(
      screen.getByText(/Prompt improved\. Translated to English for better results\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(promptBox()).toHaveValue('a cat');
    expect(promptBox()).toHaveFocus();
    expect(screen.queryByText(/Prompt improved/)).not.toBeInTheDocument();
  });

  it('forgets the note once the improved text is edited, so Undo can never throw edits away', async () => {
    mountStudio();
    await ready();
    const user = await typePrompt('a cat');
    await user.click(screen.getByRole('button', { name: 'Enhance' }));
    await screen.findByText('Prompt improved.');
    await user.type(promptBox(), '!');
    expect(screen.queryByText('Prompt improved.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('asks the enhancer for a video prompt on a video tool, in the language of the page', async () => {
    const { api } = mountStudio({ locale: 'ar' });
    await ready();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('tab')[2] as HTMLElement);
    await user.type(promptBox(), 'أمواج');
    await user.click(screen.getByRole('button', { name: 'تحسين' }));
    await waitFor(() => expect(api.callsTo('POST', '/prompt/enhance')).toHaveLength(1));
    expect(api.callsTo('POST', '/prompt/enhance')[0]?.body).toEqual({
      prompt: 'أمواج',
      kind: 'video',
      locale: 'ar',
    });
  });

  it('cuts an improved prompt that is longer than the model takes', async () => {
    mountStudio({ enhance: () => ({ prompt: `${'word '.repeat(700)}end`, translated: false }) });
    await ready();
    const user = await typePrompt('a cat');
    await user.click(screen.getByRole('button', { name: 'Enhance' }));
    await waitFor(() => expect(promptBox().value.length).toBeGreaterThan(100));
    expect(promptBox().value.length).toBeLessThanOrEqual(2000);
    expect(screen.queryByText(/too long/)).not.toBeInTheDocument();
  });

  it('keeps the prompt and says why when the enhancer refuses', async () => {
    mountStudio({
      prepare: (fake) =>
        fake.intercept((call) =>
          call.path === '/prompt/enhance' ? apiError(422, 'moderation_blocked') : undefined,
        ),
    });
    await ready();
    const user = await typePrompt('a cat');
    await user.click(screen.getByRole('button', { name: 'Enhance' }));
    expect(await screen.findByText(/content policy/)).toBeInTheDocument();
    expect(promptBox()).toHaveValue('a cat');
    expect(screen.getByRole('button', { name: 'Enhance' })).toBeEnabled();
  });

  it('does not call the enhancer for an empty prompt', async () => {
    const { api } = mountStudio();
    await ready();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Enhance' }));
    expect(await screen.findByText('Write a prompt first, then enhance it.')).toBeInTheDocument();
    expect(api.callsTo('POST', '/prompt/enhance')).toHaveLength(0);
  });

  it('"Surprise me" fills the box with an idea of the tool, and never the same one twice in a row', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    const seen = new Set<string>();
    let previous = '';
    for (let i = 0; i < 6; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Surprise me' }));
      const value = promptBox().value;
      expect(value).not.toBe('');
      expect(value).not.toBe(previous);
      previous = value;
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(1);
    // An image prompt, not a video one.
    expect(previous).not.toMatch(/time-lapse|fireflies|hummingbird/i);
  });

  it('fills the box from an example chip, and the chips go away once there is a prompt', async () => {
    mountStudio();
    await ready();
    const user = userEvent.setup();
    expect(screen.getByText('Need an idea?')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: 'A lone lighthouse on a cliff at sunset' }),
    );
    expect(promptBox()).toHaveValue(
      'A lone lighthouse on a cliff at sunset, dramatic clouds, golden hour light, cinematic',
    );
    expect(screen.queryByText('Need an idea?')).not.toBeInTheDocument();
  });

  it('fills the box from an idea on the empty canvas and puts the cursor there', async () => {
    mountStudio();
    await ready();
    const idea = screen.getByRole('button', {
      name: /A rainy neon-lit street in a futuristic city at night, reflections/,
    });
    await userEvent.setup().click(idea);
    expect(promptBox().value).toMatch(/^A rainy neon-lit street/);
    expect(promptBox()).toHaveFocus();
  });

  it('shows ideas in Arabic for an Arabic page', async () => {
    mountStudio({ locale: 'ar' });
    await ready();
    const chips = screen.getAllByRole('button', { name: /^منارة|^قطة|^شارع|^كوخ/ });
    expect(chips.length).toBeGreaterThan(0);
  });
});

/** The polite live region the studio keeps for the screen reader. */
function announcement(): string {
  const regions = screen.getAllByRole('status').filter((el) => el.classList.contains('sr-only'));
  return regions
    .map((el) => el.textContent ?? '')
    .join('')
    .replace(/​/g, '');
}

// Keep `json` imported for tests that need a custom success body.
void json;
