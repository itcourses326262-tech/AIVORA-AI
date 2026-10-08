import { defineMessages } from '@/lib/i18n/define';

export default defineMessages({
  en: {
    meta: {
      title: 'AIVORE: AI images and video from Arabic or English prompts',
      description:
        'Turn a sentence in Arabic or English into stunning images and videos in seconds. Start free with credits on sign-up. No card needed.',
      appDescription:
        'A bilingual studio for creating images and videos with AI from Arabic or English prompts, with a prompt enhancer, a personal gallery and a developer API.',
    },
    nav: {
      label: 'On this page',
      features: 'Features',
      how: 'How it works',
      credits: 'Credits',
      api: 'API',
      faq: 'FAQ',
    },
    hero: {
      badge: 'Built for Arabic and English creators',
      title: 'Imagine it in words.',
      titleAccent: 'Watch it come alive.',
      subtitle:
        'Describe a scene in Arabic or English and get stunning images and videos in seconds.',
      cta: 'Start creating free',
      ctaSecondary: 'Explore creations',
      trust: 'Sign up and get {credits} on us. No card needed.',
      trustNoBonus: 'Sign up in seconds. No card needed.',
    },
    credits: {
      zero: '0 credits',
      one: '1 credit',
      two: '2 credits',
      few: '{count} credits',
      many: '{count} credits',
      other: '{count} credits',
    },
    showcase: {
      eyebrow: 'What you can create',
      title: 'From a single sentence to a finished scene',
      subtitle:
        'Landscapes, patterns, worlds and motion. Here is a taste of what the models can do.',
      note: 'Illustrative artwork. Your results depend on the model and your prompt.',
      promptLabel: 'Prompt',
      samples: {
        dunes: 'Desert dunes at sunset, warm golden light, ultra detailed',
        skyline: 'A neon city in the rain at night, slow aerial flight',
        bloom: 'A glowing lotus flower, macro photography',
        orbit: 'A ringed planet slowly turning in deep space',
        tides: 'Waves rolling onto a quiet beach at dawn',
        peaks: 'Snowy mountain peaks under a full moon',
        arches: 'Geometric Arabic patterns in deep blue and gold',
      },
    },
    features: {
      eyebrow: 'Features',
      title: 'Everything you need to create',
      subtitle:
        'Four creative tools, a prompt enhancer that speaks Arabic, and an API for your apps.',
      textToImage:
        'Describe a scene and get images in the aspect ratio you choose, from quick drafts to detailed art.',
      imageToImage:
        'Upload a photo or a sketch, then restyle it, edit it, or build on it with a new prompt.',
      textToVideo:
        'Turn a description into a short clip with natural motion, and sound on supported models.',
      imageToVideo:
        'Bring a still image to life with camera moves and motion that follow your prompt.',
      enhancer: {
        title: 'Smart prompt enhancer',
        description:
          'Write it simply. AIVORE adds style, lighting and detail, and translates Arabic into English for models that prefer it.',
        beforeLabel: 'Your prompt',
        before: 'a cat on the moon',
        afterLabel: 'Enhanced',
        after: 'A fluffy cat resting on the moon, soft cinematic lighting, highly detailed',
      },
      api: {
        title: 'Developer API',
        description:
          'Generate from your own code with REST endpoints and API keys. Same models, same credits.',
      },
    },
    how: {
      eyebrow: 'How it works',
      title: 'From idea to result in three steps',
      step: 'Step {number}',
      steps: {
        describe: {
          title: 'Describe your idea',
          description:
            'Write a prompt in Arabic or English, or upload an image to start from. Not sure how to word it? Let the prompt enhancer do it.',
        },
        generate: {
          title: 'Pick a model and generate',
          description:
            'Choose between fast drafts and high-fidelity models. The exact credit cost is shown before you generate.',
        },
        keep: {
          title: 'Save, share, or keep iterating',
          description:
            'Every result lands in your private gallery. Download it, share a public link, or reuse the prompt to refine it.',
        },
      },
    },
    pricing: {
      eyebrow: 'Models and credits',
      title: 'Simple, transparent credits',
      subtitle:
        'One balance pays for everything. You see the exact cost before you generate, and a failed generation is refunded automatically.',
      freeTitle: 'Free to start',
      freeLead: 'Every new account gets',
      freeBody: 'Enough for up to {count} images with a fast model. No card needed.',
      imagesTitle: 'Images',
      imagesUnit: 'per image',
      videosTitle: 'Video',
      videosUnit: 'per clip',
      note: 'Sample prices for one generation. The studio always shows the exact cost first.',
    },
    api: {
      eyebrow: 'For developers',
      title: 'Build it into your own product',
      description:
        'Create an API key, send a prompt, get images and video back. The same models and credits as the studio, behind a clean REST API.',
      points: {
        json: 'Simple JSON over HTTPS',
        keys: 'API keys you can create and revoke any time',
        async: 'Asynchronous jobs you can poll for status',
        docs: 'A complete reference in the docs',
      },
      cta: 'Read the API docs',
      requestLabel: 'Create a generation',
      responseLabel: 'Response',
      copy: 'Copy command',
      copied: 'Copied',
      copyFailed: 'Could not copy. Select the command and copy it by hand.',
    },
    faq: {
      eyebrow: 'FAQ',
      title: 'Questions, answered',
      items: {
        free: {
          question: 'Do I have to pay to start?',
          answer:
            'No. Creating an account is free and needs no card. New accounts also receive free credits to try the tools.',
        },
        arabic: {
          question: 'Can I write prompts in Arabic?',
          answer:
            'Yes. Write in Arabic, English or both. Many image models understand English best, so the prompt enhancer can translate your Arabic prompt and enrich it before it is sent.',
        },
        credit: {
          question: 'What is a credit, and what if a generation fails?',
          answer:
            'Credits are the balance you spend on generations. The cost depends on the model and, for video, on length and quality. The studio shows the exact cost first, and if a generation fails the credits are refunded automatically.',
        },
        privacy: {
          question: 'Are my creations private?',
          answer:
            'Yes. Everything you generate is saved to your private gallery. Only the creations you choose to make public appear on Explore or open through a share link.',
        },
        models: {
          question: 'Which models can I use?',
          answer:
            'AIVORE connects to image and video models from leading providers, from very fast drafts to high-fidelity results. The studio lists every available model with its cost and what it does best.',
        },
        developers: {
          question: 'Can I use AIVORE from my own app?',
          answer:
            'Yes. Create an API key in your account and call the REST API with the same models and credits as the studio. The documentation has the full reference and examples.',
        },
      },
    },
    finalCta: {
      title: 'Your next idea is one sentence away',
      description: 'Create a free account and make your first image or video in under a minute.',
    },
    footer: {
      tagline: 'Turn a sentence into images and video, in Arabic or English.',
      product: 'Product',
      account: 'Account',
      rights: '© {year} AIVORE. All rights reserved.',
    },
    status: {
      home: 'Back to home',
      studio: 'Open the studio',
      explore: 'Explore creations',
      notFound: {
        eyebrow: 'Error 404',
        title: 'This page is out of frame',
        description:
          'The link may be broken, or the page may have moved. Here are some places to pick up from:',
      },
      error: {
        eyebrow: 'Unexpected error',
        title: 'Something went wrong on our side',
        description:
          'An unexpected error stopped this page from loading. You can try again, or head back home.',
        reference: 'Reference: {digest}',
      },
      globalError: {
        title: 'AIVORE hit a snag',
        description:
          'The app could not start. Reload the page, and if it keeps happening, try again in a few minutes.',
        reload: 'Reload the page',
      },
    },
  },
  ar: {
    meta: {
      title: 'AIVORE: صور وفيديوهات بالذكاء الاصطناعي من وصف عربي أو إنجليزي',
      description:
        'حوّل جملة بالعربية أو الإنجليزية إلى صور وفيديوهات مذهلة في ثوانٍ. ابدأ مجانًا برصيد هدية عند التسجيل، ودون بطاقة بنكية.',
      appDescription:
        'استوديو ثنائي اللغة لإنشاء الصور والفيديوهات بالذكاء الاصطناعي من وصف عربي أو إنجليزي، مع محسّن للوصف ومعرض شخصي وواجهة برمجية للمطوّرين.',
    },
    nav: {
      label: 'في هذه الصفحة',
      features: 'المزايا',
      how: 'كيف يعمل',
      credits: 'الرصيد',
      api: 'الواجهة البرمجية',
      faq: 'الأسئلة الشائعة',
    },
    hero: {
      badge: 'صُمّم لصنّاع المحتوى بالعربية والإنجليزية',
      title: 'تخيّلها بكلماتك.',
      titleAccent: 'وشاهدها تنبض بالحياة.',
      subtitle: 'صِف المشهد بالعربية أو الإنجليزية، واحصل على صور وفيديوهات مذهلة في ثوانٍ.',
      cta: 'ابدأ الإبداع مجانًا',
      ctaSecondary: 'استكشف الإبداعات',
      trust: 'سجّل واحصل على {credits} مجانًا. لا حاجة لبطاقة بنكية.',
      trustNoBonus: 'سجّل خلال ثوانٍ. لا حاجة لبطاقة بنكية.',
    },
    credits: {
      zero: 'بلا رصيد',
      one: 'رصيد واحد',
      two: 'رصيدان',
      few: '{count} أرصدة',
      many: '{count} رصيدًا',
      other: '{count} رصيد',
    },
    showcase: {
      eyebrow: 'ماذا يمكنك أن تصنع',
      title: 'من جملة واحدة إلى مشهد متكامل',
      subtitle: 'مناظر طبيعية وزخارف وعوالم وحركة. لمحة عمّا تستطيع النماذج فعله.',
      note: 'رسوم توضيحية. تختلف نتائجك بحسب النموذج ووصفك.',
      promptLabel: 'الوصف',
      samples: {
        dunes: 'كثبان صحراوية عند الغروب، ضوء ذهبي دافئ، تفاصيل فائقة',
        skyline: 'مدينة نيون تحت المطر ليلًا، تحليق جوي بطيء',
        bloom: 'زهرة لوتس متوهجة، تصوير ماكرو',
        orbit: 'كوكب بحلقات يدور ببطء في أعماق الفضاء',
        tides: 'أمواج تنساب على شاطئ هادئ عند الفجر',
        peaks: 'قمم جبلية مكسوّة بالثلج تحت بدر كامل',
        arches: 'زخارف عربية هندسية بالأزرق الداكن والذهبي',
      },
    },
    features: {
      eyebrow: 'المزايا',
      title: 'كل ما تحتاجه للإبداع',
      subtitle: 'أربع أدوات إبداعية، ومحسّن وصف يفهم العربية، وواجهة برمجية لتطبيقاتك.',
      textToImage:
        'صِف مشهدًا واحصل على صور بالأبعاد التي تختارها، من المسودات السريعة إلى الأعمال المفصّلة.',
      imageToImage: 'ارفع صورة أو رسمًا أوليًا، ثم غيّر أسلوبه أو عدّله أو ابنِ عليه بوصف جديد.',
      textToVideo: 'حوّل وصفًا نصيًا إلى مقطع قصير بحركة طبيعية، ومع صوت في النماذج التي تدعمه.',
      imageToVideo: 'أضف الحياة إلى صورة ثابتة بحركة كاميرا وحركة عناصر تتبع وصفك.',
      enhancer: {
        title: 'محسّن الوصف الذكي',
        description:
          'اكتب بعفوية، ويضيف AIVORE الأسلوب والإضاءة والتفاصيل، ويترجم العربية إلى الإنجليزية للنماذج التي تفضّلها.',
        beforeLabel: 'وصفك',
        before: 'قطة على القمر',
        afterLabel: 'بعد التحسين',
        after:
          'A fluffy cat sitting on the moon, glowing stars, cinematic lighting, ultra detailed',
      },
      api: {
        title: 'واجهة برمجية للمطوّرين',
        description: 'ولّد من شيفرتك الخاصة عبر واجهة REST ومفاتيح API. النماذج والرصيد نفسهما.',
      },
    },
    how: {
      eyebrow: 'كيف يعمل',
      title: 'من الفكرة إلى النتيجة في ثلاث خطوات',
      step: 'الخطوة {number}',
      steps: {
        describe: {
          title: 'صِف فكرتك',
          description:
            'اكتب وصفك بالعربية أو الإنجليزية، أو ارفع صورة لتبدأ منها. لست متأكدًا من الصياغة؟ دع محسّن الوصف يتولى الأمر.',
        },
        generate: {
          title: 'اختر النموذج وابدأ التوليد',
          description:
            'اختر بين مسودات سريعة ونماذج عالية الدقة. تظهر لك التكلفة بالضبط قبل أن تبدأ التوليد.',
        },
        keep: {
          title: 'احفظ وشارك وواصل التحسين',
          description:
            'تصل كل نتيجة إلى معرضك الخاص. نزّلها، أو شارك رابطًا عامًا، أو أعد استخدام الوصف لتحسينها.',
        },
      },
    },
    pricing: {
      eyebrow: 'النماذج والرصيد',
      title: 'رصيد بسيط وواضح',
      subtitle:
        'رصيد واحد يغطي كل شيء. تعرف التكلفة بالضبط قبل التوليد، ويُعاد رصيدك تلقائيًا إذا فشلت العملية.',
      freeTitle: 'ابدأ مجانًا',
      freeLead: 'يحصل كل حساب جديد على',
      freeBody: 'تكفي لإنشاء ما يصل إلى {count} صورة بنموذج سريع. لا حاجة لبطاقة بنكية.',
      imagesTitle: 'الصور',
      imagesUnit: 'للصورة الواحدة',
      videosTitle: 'الفيديو',
      videosUnit: 'للمقطع',
      note: 'أمثلة على الأسعار لكل عملية توليد. يعرض لك الاستوديو التكلفة بالضبط قبل البدء.',
    },
    api: {
      eyebrow: 'للمطوّرين',
      title: 'ادمجه في منتجك الخاص',
      description:
        'أنشئ مفتاح API، وأرسل وصفك، واستلم الصور والفيديوهات. النماذج والرصيد نفسهما في الاستوديو، عبر واجهة REST بسيطة.',
      points: {
        json: 'JSON بسيط عبر HTTPS',
        keys: 'مفاتيح API تنشئها وتلغيها متى شئت',
        async: 'مهام غير متزامنة يمكنك متابعة حالتها',
        docs: 'مرجع كامل في التوثيق',
      },
      cta: 'اقرأ توثيق الواجهة',
      requestLabel: 'إنشاء عملية توليد',
      responseLabel: 'الاستجابة',
      copy: 'نسخ الأمر',
      copied: 'تم النسخ',
      copyFailed: 'تعذّر النسخ. حدّد الأمر وانسخه يدويًا.',
    },
    faq: {
      eyebrow: 'الأسئلة الشائعة',
      title: 'أسئلتكم، وأجوبتنا',
      items: {
        free: {
          question: 'هل أحتاج إلى الدفع للبدء؟',
          answer:
            'لا. إنشاء الحساب مجاني ولا يتطلب بطاقة بنكية. وتحصل الحسابات الجديدة على رصيد مجاني لتجربة الأدوات.',
        },
        arabic: {
          question: 'هل يمكنني كتابة الوصف بالعربية؟',
          answer:
            'نعم. اكتب بالعربية أو الإنجليزية أو بهما معًا. وبما أن كثيرًا من نماذج الصور يفهم الإنجليزية أفضل، يستطيع محسّن الوصف ترجمة وصفك العربي وإثراءه قبل إرساله.',
        },
        credit: {
          question: 'ما هو الرصيد، وماذا لو فشلت عملية التوليد؟',
          answer:
            'الرصيد هو ما تنفقه على عمليات التوليد. تعتمد التكلفة على النموذج، وفي الفيديو على المدة والجودة أيضًا. يعرض لك الاستوديو التكلفة بالضبط مسبقًا، وإذا فشلت العملية يُعاد رصيدك تلقائيًا.',
        },
        privacy: {
          question: 'هل أعمالي خاصة؟',
          answer:
            'نعم. كل ما تنشئه يُحفظ في معرضك الخاص. وحدها الأعمال التي تختار جعلها عامة تظهر في صفحة الاستكشاف أو تُفتح عبر رابط المشاركة.',
        },
        models: {
          question: 'ما النماذج التي يمكنني استخدامها؟',
          answer:
            'يتصل AIVORE بنماذج صور وفيديو من مزوّدين رائدين، من المسودات فائقة السرعة إلى النتائج عالية الدقة. يعرض الاستوديو كل نموذج متاح مع تكلفته وما يتفوق فيه.',
        },
        developers: {
          question: 'هل أستطيع استخدام AIVORE من تطبيقي؟',
          answer:
            'نعم. أنشئ مفتاح API من حسابك واستدعِ الواجهة البرمجية بالنماذج والرصيد نفسيهما في الاستوديو. يحتوي التوثيق على المرجع الكامل وأمثلة جاهزة.',
        },
      },
    },
    finalCta: {
      title: 'فكرتك التالية على بُعد جملة واحدة',
      description: 'أنشئ حسابًا مجانيًا، وابتكر أول صورة أو فيديو لك في أقل من دقيقة.',
    },
    footer: {
      tagline: 'حوّل جملة واحدة إلى صور وفيديوهات، بالعربية أو الإنجليزية.',
      product: 'المنتج',
      account: 'الحساب',
      rights: '© {year} AIVORE. جميع الحقوق محفوظة.',
    },
    status: {
      home: 'العودة إلى الرئيسية',
      studio: 'افتح الاستوديو',
      explore: 'استكشف الإبداعات',
      notFound: {
        eyebrow: 'خطأ 404',
        title: 'هذه الصفحة خارج الإطار',
        description: 'قد يكون الرابط معطّلًا أو أن الصفحة نُقلت. إليك بعض الوجهات للمتابعة:',
      },
      error: {
        eyebrow: 'خطأ غير متوقع',
        title: 'حدث خطأ من جانبنا',
        description:
          'أوقف خطأ غير متوقع تحميل هذه الصفحة. يمكنك المحاولة مرة أخرى أو العودة إلى الرئيسية.',
        reference: 'المرجع: {digest}',
      },
      globalError: {
        title: 'واجهت AIVORE مشكلة مؤقتة',
        description: 'تعذّر تشغيل التطبيق. أعد تحميل الصفحة، وإن تكرر الأمر فحاول بعد بضع دقائق.',
        reload: 'إعادة تحميل الصفحة',
      },
    },
  },
});
