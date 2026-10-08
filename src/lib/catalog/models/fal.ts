import type { AspectRatio, ModelSpec } from '../types';

/*
 * Models served by fal.ai through its queue API (`server/providers/fal`).
 *
 * Verification (2026-10-08): the build sandbox could not reach fal.ai (every fal host is blocked by
 * the egress policy), so nothing was called live. What each source covers:
 *  - Endpoint ids, input fields, enums and output shapes: the generated endpoint types shipped in
 *    `@fal-ai/client` 1.11.0-alpha.5 (published 2026-10-06), which contain all nine ids below.
 *  - Queue protocol and the `Authorization: Key` header: the same package's source (1.10.1).
 *  - Prices: fal's own model pages as returned by web-search excerpts on 2026-10-08. Some excerpts
 *    were months old; a price that could not be confirmed is flagged `UNVERIFIED:` below.
 * Re-check a price on the model page before changing a number here.
 *
 * Credits: 1 credit is about USD 0.004 of UPSTREAM cost. Every per-unit price below is the upstream
 * price divided by 0.004 and rounded up to a whole credit (images: per image, video: per second).
 *
 * Public ids carry a `fal-` prefix so they can never collide with the same model offered through
 * another provider (the catalog refuses duplicate ids).
 *
 * Models that accept an input image keep the proportions of that image (Veo is the exception: its
 * aspect ratio is chosen), so for them the aspect ratio chip is ignored, as for the Demo models.
 */

const ALL_RATIOS: AspectRatio[] = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const WAN_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const VEO_RATIOS: AspectRatio[] = ['16:9', '9:16'];

export const falModels: ModelSpec[] = [
  // ---- text-to-image ---------------------------------------------------------------------------
  {
    // Price: USD 0.003 per megapixel (fal.ai/models/fal-ai/flux/schnell, 2026-10-08). Every size we
    // send is under 1 MP, so one image is USD 0.003 = 0.75 credit, rounded up to 1.
    id: 'fal-flux-schnell',
    provider: 'fal',
    providerModel: 'fal-ai/flux/schnell',
    kind: 'image',
    tools: ['text-to-image'],
    label: 'FLUX.1 Schnell',
    description: {
      en: 'Very fast and very cheap: good everyday pictures in about a second. Best for quick ideas and drafts; it does not take a negative prompt.',
      ar: 'سريع جدًا ورخيص جدًا: صور جيدة للاستخدام اليومي في نحو ثانية. مناسب للأفكار السريعة والمسودات، ولا يدعم الوصف السلبي.',
    },
    badges: ['fast'],
    limits: {
      maxPromptChars: 2000,
      aspectRatios: ALL_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'image', perImage: 1 },
  },
  {
    // Price: USD 0.03 for the first megapixel (fal.ai/models/fal-ai/flux-2-pro, 2026-10-08), so one
    // image under 1 MP is 7.5 credits, rounded up to 8. UNVERIFIED: whether fal counts a megapixel
    // as 10^6 or 2^20 pixels (our sizes stay under 10^6). The input schema has no num_images
    // field, hence maxCount 1.
    id: 'fal-flux-2-pro',
    provider: 'fal',
    providerModel: 'fal-ai/flux-2-pro',
    kind: 'image',
    tools: ['text-to-image'],
    label: 'FLUX.2 Pro',
    description: {
      en: 'A balanced, high-fidelity model with sharp detail, natural lighting and good text rendering inside the image. One image per request.',
      ar: 'نموذج متوازن عالي الدقة بتفاصيل حادة وإضاءة طبيعية وكتابة نصوص جيدة داخل الصورة. صورة واحدة في كل طلب.',
    },
    badges: ['quality'],
    limits: {
      maxPromptChars: 4000,
      aspectRatios: ALL_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 1,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'image', perImage: 8 },
  },
  {
    // Price: USD 0.15 per image at 1K, double at 4K (fal.ai/models/fal-ai/nano-banana-pro,
    // 2026-10-08). We only request 1K: 37.5 credits, rounded up to 38.
    id: 'fal-nano-banana-pro',
    provider: 'fal',
    providerModel: 'fal-ai/nano-banana-pro',
    kind: 'image',
    tools: ['text-to-image'],
    label: 'Nano Banana Pro',
    description: {
      en: "Google's premium image model: it follows long, detailed prompts closely, composes complex scenes and renders text well. Priced as a premium model.",
      ar: 'نموذج الصور المتقدم من Google: يلتزم بالأوصاف الطويلة والدقيقة، ويركّب مشاهد معقدة، ويكتب النصوص داخل الصورة بإتقان. تسعيره مرتفع لأنه نموذج متميز.',
    },
    badges: ['quality'],
    limits: {
      maxPromptChars: 4000,
      aspectRatios: ALL_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'image', perImage: 38 },
  },

  // ---- image-to-image --------------------------------------------------------------------------
  {
    // Price: USD 0.15 per image at 1K (fal.ai/models/fal-ai/nano-banana-pro/edit, 2026-10-08):
    // 37.5 credits, rounded up to 38.
    id: 'fal-nano-banana-pro-edit',
    provider: 'fal',
    providerModel: 'fal-ai/nano-banana-pro/edit',
    kind: 'image',
    tools: ['image-to-image'],
    label: 'Nano Banana Pro Edit',
    description: {
      en: 'Edit your picture with plain words: change objects, style, lighting or text while the rest stays intact. The result keeps the proportions of your image.',
      ar: 'عدّل صورتك بكلمات بسيطة: غيّر العناصر أو الأسلوب أو الإضاءة أو النصوص مع بقاء بقية الصورة كما هي. تحافظ النتيجة على أبعاد صورتك.',
    },
    badges: ['quality'],
    limits: {
      maxPromptChars: 4000,
      aspectRatios: ALL_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'image', perImage: 38 },
  },
  {
    // Price: USD 0.03 per megapixel (fal.ai/models/fal-ai/flux/dev/image-to-image, 2026-10-08; one
    // third-party page quoted 0.04). The adapter shrinks the input to under 1 MP, which is what the
    // output size follows: 7.5 credits, rounded up to 8.
    id: 'fal-flux-dev-img2img',
    provider: 'fal',
    providerModel: 'fal-ai/flux/dev/image-to-image',
    kind: 'image',
    tools: ['image-to-image'],
    label: 'FLUX.1 Dev Image to Image',
    description: {
      en: 'Restyle a picture from a prompt. Strength sets how far the result may drift from your image: low keeps it close, high repaints it. The result keeps your image proportions.',
      ar: 'أعد تصميم صورتك بحسب الوصف. تحدد «القوة» مقدار ابتعاد النتيجة عن صورتك: القيمة المنخفضة تبقيها قريبة والعالية تعيد رسمها. تحافظ النتيجة على أبعاد صورتك.',
    },
    limits: {
      maxPromptChars: 2000,
      aspectRatios: ALL_RATIOS,
      defaultAspectRatio: '1:1',
      maxCount: 4,
      defaultCount: 1,
      supportsNegativePrompt: false,
      supportsSeed: true,
      supportsStrength: true,
    },
    pricing: { type: 'image', perImage: 8 },
  },

  // ---- text-to-video ---------------------------------------------------------------------------
  {
    // Price: USD 0.10 per second at 720p and 0.15 at 1080p (fal.ai/models/wan/v2.6/text-to-video,
    // 2026-10-08): 25 and 37.5 credits per second, rounded up to 25 and 38. UNVERIFIED: the
    // excerpt of that page was months old. Newer Wan generations exist (3.0), see providers/fal.
    id: 'fal-wan-2-6-t2v',
    provider: 'fal',
    providerModel: 'wan/v2.6/text-to-video',
    kind: 'video',
    tools: ['text-to-video'],
    label: 'Wan 2.6',
    description: {
      en: "Alibaba's Wan video model: smooth motion and good prompt following, clips of 5, 10 or 15 seconds. A cheaper way to try an idea than Veo.",
      ar: 'نموذج الفيديو Wan من Alibaba: حركة سلسة والتزام جيد بالوصف، مقاطع من 5 أو 10 أو 15 ثانية. طريقة أرخص من Veo لتجربة فكرة.',
    },
    limits: {
      maxPromptChars: 1500,
      aspectRatios: WAN_RATIOS,
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [5, 10, 15],
      defaultDuration: 5,
      resolutions: ['720p', '1080p'],
      defaultResolution: '720p',
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '720p': 25, '1080p': 38 } },
  },
  {
    // Price: USD 0.15 per second with audio at 720p (fal.ai/models/fal-ai/veo3.1/fast, 2026-10-08;
    // without audio it is 0.10): 37.5 credits, rounded up to 38. We always ask for audio. Only 720p
    // is offered: Google limits 1080p to 8 s clips and we could not confirm fal lifts that, and 4K
    // is priced separately.
    id: 'fal-veo-3-1-fast',
    provider: 'fal',
    providerModel: 'fal-ai/veo3.1/fast',
    kind: 'video',
    tools: ['text-to-video'],
    label: 'Veo 3.1 Fast',
    description: {
      en: "Google's Veo with native sound: dialogue, effects and ambience are generated together with the picture. Clips of 4, 6 or 8 seconds at 720p.",
      ar: 'نموذج Veo من Google بصوت مدمج: الحوار والمؤثرات والأجواء تُولَّد مع الصورة. مقاطع من 4 أو 6 أو 8 ثوانٍ بدقة 720p.',
    },
    badges: ['audio', 'quality'],
    limits: {
      maxPromptChars: 2000,
      aspectRatios: VEO_RATIOS,
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [4, 6, 8],
      defaultDuration: 4,
      resolutions: ['720p'],
      defaultResolution: '720p',
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '720p': 38 } },
  },

  // ---- image-to-video --------------------------------------------------------------------------
  {
    // Price as the text-to-video Wan 2.6: USD 0.10 / 0.15 per second (fal.ai/models/wan/v2.6/
    // image-to-video, 2026-10-08). UNVERIFIED: the price excerpt was months old.
    id: 'fal-wan-2-6-i2v',
    provider: 'fal',
    providerModel: 'wan/v2.6/image-to-video',
    kind: 'video',
    tools: ['image-to-video'],
    label: 'Wan 2.6',
    description: {
      en: 'Brings your picture to life with smooth motion that follows your prompt. Clips of 5, 10 or 15 seconds. The video keeps the proportions of your image.',
      ar: 'يمنح صورتك حياة بحركة سلسة تتبع وصفك. مقاطع من 5 أو 10 أو 15 ثانية. يحافظ الفيديو على أبعاد صورتك.',
    },
    limits: {
      maxPromptChars: 1500,
      aspectRatios: WAN_RATIOS,
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [5, 10, 15],
      defaultDuration: 5,
      resolutions: ['720p', '1080p'],
      defaultResolution: '720p',
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '720p': 25, '1080p': 38 } },
  },
  {
    // Price as the text-to-video Veo 3.1 Fast: USD 0.15 per second with audio at 720p
    // (fal.ai/models/fal-ai/veo3.1/fast/image-to-video, 2026-10-08).
    id: 'fal-veo-3-1-fast-i2v',
    provider: 'fal',
    providerModel: 'fal-ai/veo3.1/fast/image-to-video',
    kind: 'video',
    tools: ['image-to-video'],
    label: 'Veo 3.1 Fast',
    description: {
      en: "Animates your picture with Google's Veo and adds matching sound. Clips of 4, 6 or 8 seconds at 720p, in landscape or portrait.",
      ar: 'يحرّك صورتك بنموذج Veo من Google ويضيف صوتًا مناسبًا. مقاطع من 4 أو 6 أو 8 ثوانٍ بدقة 720p، بالعرض أو بالطول.',
    },
    badges: ['audio', 'quality'],
    limits: {
      maxPromptChars: 2000,
      aspectRatios: VEO_RATIOS,
      defaultAspectRatio: '16:9',
      maxCount: 1,
      defaultCount: 1,
      durations: [4, 6, 8],
      defaultDuration: 4,
      resolutions: ['720p'],
      defaultResolution: '720p',
      supportsNegativePrompt: true,
      supportsSeed: true,
      supportsStrength: false,
    },
    pricing: { type: 'video', perSecond: { '720p': 38 } },
  },
];
