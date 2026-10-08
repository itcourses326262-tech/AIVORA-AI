import type { GenerationDTO } from '@/lib/api-types';

/**
 * What a generation card can ask its page to do. Every handler is optional: the card and its menu
 * show an action only when its handler is given (and the generation is in a state where it makes
 * sense), so the studio and the gallery each pick the actions they support.
 */
export interface GenerationHandlers {
  /** Opens the viewer on result number `index`. */
  onOpen?: (generation: GenerationDTO, index: number) => void;
  onToggleFavorite?: (generation: GenerationDTO) => void;
  /** Turns sharing to Explore on or off. */
  onTogglePublic?: (generation: GenerationDTO) => void;
  /** Copies the public link; offered only while the generation is shared. */
  onCopyLink?: (generation: GenerationDTO) => void;
  /** Cancels a queued or running generation. */
  onCancel?: (generation: GenerationDTO) => void;
  onDelete?: (generation: GenerationDTO) => void;
  /** Puts the generation's settings back into the studio form. */
  onReuse?: (generation: GenerationDTO) => void;
  /** Submits a failed or canceled generation again with the same settings. */
  onRetry?: (generation: GenerationDTO) => void;
  /** Makes result number `outputIndex` the input image of an image tool. */
  onUseAsInput?: (generation: GenerationDTO, outputIndex: number) => void;
}
