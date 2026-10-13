/** Close-up used in the bottom dialogue bar. Heroes and the valley NPCs. */
export type PortraitId = 'kaien' | 'oren' | 'suri' | 'master' | 'villager' | 'smith';

export type TalkExpression = 'neutral' | 'smile' | 'serious' | 'surprise';

export interface TalkLine {
  text: string;
  expression: TalkExpression;
}

const PORTRAIT_IDS: readonly PortraitId[] = ['kaien', 'oren', 'suri', 'master', 'villager', 'smith'];

export function portraitOf(id: string): PortraitId {
  return (PORTRAIT_IDS as readonly string[]).includes(id) ? (id as PortraitId) : 'kaien';
}
