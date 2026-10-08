import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/components/legal/metadata';

export function generateMetadata(): Promise<Metadata> {
  return legalMetadata('privacy');
}

export default function PrivacyPage() {
  return <LegalDocument slug="privacy" />;
}
