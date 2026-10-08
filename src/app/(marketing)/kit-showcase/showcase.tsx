'use client';

import {
  ArrowRight,
  Download,
  ImagePlus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  Directional,
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  EmptyState,
  ErrorState,
  Field,
  FormError,
  IconButton,
  Input,
  Kbd,
  Logo,
  Progress,
  RadioGroup,
  SegmentedControl,
  Select,
  Separator,
  Sheet,
  Skeleton,
  SkeletonText,
  Slider,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  toast,
} from '@/components/ui';
import { ApiError } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-8 first:border-t-0">
      <h2 className="text-sm font-semibold tracking-wide text-subtle uppercase">{title}</h2>
      {children}
    </section>
  );
}

export function Showcase() {
  const { locale } = useI18n();
  const ar = locale === 'ar';
  const [dialog, setDialog] = useState(false);
  const [alertDialog, setAlertDialog] = useState(false);
  const [sheet, setSheet] = useState<'start' | 'end' | 'bottom' | null>(null);
  const [slider, setSlider] = useState(5);
  const [seg, setSeg] = useState('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [loading, setLoading] = useState(false);

  return (
    <div className="grid gap-2">
      <div className="mb-6 flex flex-wrap items-center gap-6">
        <Logo label="AIVORE" className="h-10" />
        <Logo variant="glyph" label={null} className="size-10" />
        <h1 className="text-gradient-brand text-4xl font-bold sm:text-5xl">
          {ar ? 'تخيّل. ثم أنشئ.' : 'Imagine it. Generate it.'}
        </h1>
      </div>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>{ar ? 'ابدأ الإبداع' : 'Start creating'}</Button>
          <Button variant="secondary">{ar ? 'ثانوي' : 'Secondary'}</Button>
          <Button variant="outline">{ar ? 'محدد' : 'Outline'}</Button>
          <Button variant="ghost">{ar ? 'شفاف' : 'Ghost'}</Button>
          <Button variant="danger" startIcon={<Trash2 />}>
            {ar ? 'حذف' : 'Delete'}
          </Button>
          <Button variant="link">{ar ? 'رابط' : 'Link'}</Button>
          <Button disabled>{ar ? 'معطّل' : 'Disabled'}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">{ar ? 'صغير' : 'Small'}</Button>
          <Button size="md">{ar ? 'متوسط' : 'Medium'}</Button>
          <Button
            size="lg"
            endIcon={
              <Directional>
                <ArrowRight />
              </Directional>
            }
          >
            {ar ? 'كبير' : 'Large'}
          </Button>
          <Button
            loading={loading}
            startIcon={<Sparkles />}
            onClick={() => {
              setLoading(true);
              setTimeout(() => setLoading(false), 2000);
            }}
          >
            {loading ? (ar ? 'جارٍ الإنشاء…' : 'Generating…') : ar ? 'إنشاء' : 'Generate'}
          </Button>
          <Button
            href="/explore"
            variant="secondary"
            endIcon={
              <Directional>
                <ArrowRight />
              </Directional>
            }
          >
            {ar ? 'رابط داخلي' : 'Internal link'}
          </Button>
          <Button fullWidth variant="outline" className="sm:max-w-xs">
            {ar ? 'عرض كامل' : 'Full width'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton label="Add">
            <Plus />
          </IconButton>
          <IconButton label="Download" variant="secondary">
            <Download />
          </IconButton>
          <IconButton label="Delete" variant="danger">
            <Trash2 />
          </IconButton>
          <IconButton label="Search" variant="outline" size="sm">
            <Search />
          </IconButton>
          <IconButton label="Generate" variant="primary" size="lg">
            <Wand2 />
          </IconButton>
          <Tooltip content={ar ? 'نصيحة سريعة' : 'A quick tip'}>
            <Button variant="secondary">{ar ? 'مرّر هنا' : 'Hover me'}</Button>
          </Tooltip>
        </div>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="grid content-start gap-5">
            <Field
              label={ar ? 'البريد الإلكتروني' : 'Email'}
              hint={ar ? 'لن نشاركه مع أحد.' : "We'll never share it."}
              required
            >
              <Input type="email" placeholder="you@example.com" startAdornment={<Search />} />
            </Field>
            <Field
              label={ar ? 'كلمة المرور' : 'Password'}
              error={ar ? '٨ أحرف على الأقل.' : 'At least 8 characters.'}
            >
              <Input type="password" defaultValue="abc" />
            </Field>
            <Field label={ar ? 'الوصف' : 'Prompt'} optional>
              <Textarea
                autoGrow
                showCount
                maxLength={200}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={ar ? 'صِف ما تريد إنشاءه' : 'Describe what you want to create'}
              />
            </Field>
            <Field label={ar ? 'النموذج' : 'Model'}>
              <Select defaultValue="b">
                <option value="a">Flux Schnell</option>
                <option value="b">{ar ? 'نموذج تجريبي' : 'Demo model'}</option>
              </Select>
            </Field>
            <Field label="Disabled" disabled>
              <Input defaultValue="Locked" />
            </Field>
          </div>
          <div className="grid content-start gap-5">
            <Switch
              label={ar ? 'جعل العمل عامًا' : 'Make public'}
              description={ar ? 'يظهر في صفحة استكشاف.' : 'Shows up in Explore.'}
              defaultChecked
            />
            <Switch label={ar ? 'إيقاف' : 'Off'} />
            <Checkbox label={ar ? 'أوافق على الشروط' : 'I agree to the terms'} />
            <Checkbox label={ar ? 'محدد جزئيًا' : 'Indeterminate'} indeterminate readOnly />
            <Checkbox label={ar ? 'محدد' : 'Checked'} defaultChecked />
            <RadioGroup
              aria-label="Quality"
              defaultValue="b"
              options={[
                {
                  value: 'a',
                  label: ar ? 'سريع' : 'Fast',
                  description: ar ? 'نتائج في ثوانٍ.' : 'Results in seconds.',
                },
                { value: 'b', label: ar ? 'متوازن' : 'Balanced' },
                { value: 'c', label: ar ? 'جودة عالية' : 'High quality', disabled: true },
              ]}
            />
            <RadioGroup
              aria-label="Aspect"
              appearance="card"
              orientation="horizontal"
              value={aspect}
              onValueChange={setAspect}
              options={[
                { value: '1:1', label: '1:1' },
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
              ]}
            />
            <SegmentedControl
              aria-label="Kind"
              value={seg}
              onValueChange={setSeg}
              options={[
                {
                  value: 'image',
                  label: (
                    <>
                      <ImagePlus />
                      {ar ? 'صورة' : 'Image'}
                    </>
                  ),
                },
                { value: 'video', label: ar ? 'فيديو' : 'Video' },
                { value: 'audio', label: ar ? 'صوت' : 'Audio', disabled: true },
              ]}
            />
            <div className="grid gap-2">
              <div className="flex justify-between text-sm">
                <span id="dur">{ar ? 'المدة' : 'Duration'}</span>
                <span className="text-muted tabular-nums">{slider}s</span>
              </div>
              <Slider
                aria-labelledby="dur"
                min={3}
                max={10}
                step={1}
                value={slider}
                onValueChange={setSlider}
                formatValue={(v) => `${v} seconds`}
              />
            </div>
            <FormError error={new ApiError('rate_limited', 429, 'x')} />
          </div>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="a">
          <TabsList aria-label="Demo">
            <TabsTrigger value="a">{ar ? 'نص إلى صورة' : 'Text to image'}</TabsTrigger>
            <TabsTrigger value="b">{ar ? 'صورة إلى صورة' : 'Image to image'}</TabsTrigger>
            <TabsTrigger value="c">{ar ? 'فيديو' : 'Video'}</TabsTrigger>
          </TabsList>
          <TabsContent value="a">
            <p className="text-muted">{ar ? 'محتوى التبويب الأول.' : 'First tab content.'}</p>
          </TabsContent>
          <TabsContent value="b">
            <p className="text-muted">{ar ? 'محتوى التبويب الثاني.' : 'Second tab content.'}</p>
          </TabsContent>
          <TabsContent value="c">
            <p className="text-muted">{ar ? 'محتوى التبويب الثالث.' : 'Third tab content.'}</p>
          </TabsContent>
        </Tabs>
        <Tabs defaultValue="a" appearance="pills">
          <TabsList aria-label="Pills">
            <TabsTrigger value="a">{ar ? 'الكل' : 'All'}</TabsTrigger>
            <TabsTrigger value="b">{ar ? 'صور' : 'Images'}</TabsTrigger>
            <TabsTrigger value="c">{ar ? 'فيديو' : 'Videos'}</TabsTrigger>
          </TabsList>
        </Tabs>
      </Section>

      <Section title="Overlays & feedback">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => setDialog(true)}>
            Dialog
          </Button>
          <Button variant="secondary" onClick={() => setAlertDialog(true)}>
            Alert dialog
          </Button>
          <Button variant="secondary" onClick={() => setSheet('end')}>
            Sheet end
          </Button>
          <Button variant="secondary" onClick={() => setSheet('start')}>
            Sheet start
          </Button>
          <Button variant="secondary" onClick={() => setSheet('bottom')}>
            Sheet bottom
          </Button>
          <DropdownMenu
            label="Actions"
            trigger={<Button variant="outline">{ar ? 'قائمة' : 'Menu'}</Button>}
          >
            <DropdownMenuLabel>{ar ? 'إجراءات' : 'Actions'}</DropdownMenuLabel>
            <DropdownMenuItem shortcut={<Kbd>⌘D</Kbd>}>
              <Download />
              {ar ? 'تنزيل' : 'Download'}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Sparkles />
              {ar ? 'إعادة استخدام الوصف' : 'Reuse prompt'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>{ar ? 'معطّل' : 'Disabled'}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
              <Trash2 />
              {ar ? 'حذف' : 'Delete'}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() =>
              toast.success(ar ? 'تم الحفظ' : 'Saved', {
                description: ar ? 'تم تحديث إعداداتك.' : 'Your settings were updated.',
              })
            }
          >
            Success toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.error(ar ? 'تعذّر الاتصال بالخادم' : 'Could not reach the server', {
                description: ar
                  ? 'تحقق من اتصالك وحاول مرة أخرى.'
                  : 'Check your connection and try again.',
              })
            }
          >
            Error toast
          </Button>
          <Button
            variant="outline"
            onClick={() => toast.info(ar ? 'بدأ الإنشاء' : 'Generation started')}
          >
            Info toast
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              toast.warning(ar ? 'رصيدك على وشك النفاد' : 'Credits running low', {
                action: { label: ar ? 'اشحن' : 'Top up', onClick: () => {} },
              })
            }
          >
            Warning + action
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge>{ar ? 'افتراضي' : 'Neutral'}</Badge>
          <Badge variant="brand" dot>
            {ar ? 'جديد' : 'New'}
          </Badge>
          <Badge variant="success" dot>
            {ar ? 'اكتمل' : 'Succeeded'}
          </Badge>
          <Badge variant="warning" dot>
            {ar ? 'قيد الانتظار' : 'Queued'}
          </Badge>
          <Badge variant="danger" dot>
            {ar ? 'فشل' : 'Failed'}
          </Badge>
          <Badge variant="info">{ar ? 'تجريبي' : 'Demo'}</Badge>
          <Badge variant="outline" size="sm">
            {ar ? 'سريع' : 'Fast'}
          </Badge>
          <Avatar name="Layla Hassan" />
          <Avatar name="سارة العلي" size="lg" />
          <Avatar name="Omar" size="sm" />
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
          <Spinner size="sm" />
          <Spinner />
          <Spinner size="lg" />
        </div>
        <div className="grid max-w-md gap-4">
          <Progress value={64} showValue label="Generation" />
          <Progress value={20} size="sm" label="Small" />
          <Progress label="Waiting" />
        </div>
      </Section>

      <Section title="Cards & states">
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>{ar ? 'نص إلى صورة' : 'Text to image'}</CardTitle>
              <CardDescription>
                {ar ? 'صِف مشهدًا واحصل على صور.' : 'Describe a scene and get images.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="brand">1 {ar ? 'رصيد' : 'credit'}</Badge>
            </CardContent>
            <CardFooter>
              <Button size="sm" variant="secondary">
                {ar ? 'افتح' : 'Open'}
              </Button>
            </CardFooter>
          </Card>
          <Card href="/explore" variant="raised">
            <CardHeader>
              <CardTitle>{ar ? 'بطاقة رابط' : 'Link card'}</CardTitle>
              <CardDescription>
                {ar ? 'تنقر على البطاقة كلها.' : 'The whole card is the link.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SkeletonText lines={2} />
            </CardContent>
          </Card>
          <Card variant="gradient" interactive>
            <CardHeader>
              <CardTitle>{ar ? 'حدود متدرجة' : 'Gradient border'}</CardTitle>
              <CardDescription>{ar ? 'للمحتوى المميز.' : 'For featured content.'}</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-3">
              <Skeleton className="size-12 rounded-xl" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-3.5" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            </CardContent>
          </Card>
        </div>
        <Separator />
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={<ImagePlus />}
            title={ar ? 'لا توجد أعمال بعد' : 'No creations yet'}
            description={
              ar
                ? 'ستظهر هنا الصور والفيديوهات التي تنشئها.'
                : 'The images and videos you create will appear here.'
            }
            action={
              <Button href="/studio" startIcon={<Sparkles />}>
                {ar ? 'ابدأ الإنشاء' : 'Start creating'}
              </Button>
            }
          />
          <ErrorState
            error={new ApiError('network_error', 0, 'x')}
            onRetry={() => toast.info('retry')}
          />
        </div>
      </Section>

      <Dialog
        open={dialog}
        onOpenChange={setDialog}
        title={ar ? 'مشاركة العمل' : 'Share creation'}
        description={
          ar ? 'أي شخص لديه الرابط يمكنه المشاهدة.' : 'Anyone with the link can view it.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDialog(false)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button onClick={() => setDialog(false)}>{ar ? 'نسخ الرابط' : 'Copy link'}</Button>
          </>
        }
      >
        <Field label={ar ? 'الرابط' : 'Link'}>
          <Input defaultValue="https://aivore.app/s/gen_01hx" readOnly dir="ltr" />
        </Field>
        <div className="mt-4">
          <DropdownMenu
            label="More"
            trigger={
              <Button variant="outline" size="sm">
                {ar ? 'المزيد' : 'More'}
              </Button>
            }
          >
            <DropdownMenuItem>{ar ? 'خيار' : 'Option'}</DropdownMenuItem>
            <DropdownMenuItem>{ar ? 'خيار آخر' : 'Another'}</DropdownMenuItem>
          </DropdownMenu>
        </div>
      </Dialog>
      <Dialog
        open={alertDialog}
        onOpenChange={setAlertDialog}
        role="alertdialog"
        size="sm"
        dismissible={false}
        title={ar ? 'حذف هذا العمل؟' : 'Delete this creation?'}
        description={ar ? 'لا يمكن التراجع عن هذا الإجراء.' : 'This cannot be undone.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAlertDialog(false)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </Button>
            <Button variant="danger" onClick={() => setAlertDialog(false)}>
              {ar ? 'حذف' : 'Delete'}
            </Button>
          </>
        }
      />
      <Sheet
        open={sheet !== null}
        onOpenChange={(open) => !open && setSheet(null)}
        side={sheet ?? 'end'}
        title={ar ? 'التفاصيل' : 'Details'}
        description={ar ? 'معلومات عن هذا العمل.' : 'Information about this creation.'}
      >
        <SkeletonText lines={5} />
      </Sheet>
    </div>
  );
}
