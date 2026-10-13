import { Image, View } from 'react-native';
import sheet from '../../../assets/generated/sprites/Nuevos/Entorno/rostros.png';
import type { PortraitId, TalkExpression } from '../../game/content/dialogue';

/** rostros.png: 4 columns by 6 rows, every bust looking to the right. */
const COLS = 4;
const ROWS = 6;

const ROW: Record<PortraitId, number> = {
  kaien: 0,
  oren: 1,
  suri: 2,
  master: 3,
  villager: 4,
  smith: 5,
};

const COL: Record<TalkExpression, number> = {
  neutral: 0,
  smile: 1,
  serious: 2,
  surprise: 3,
};

export function Portrait({ id, expression, flip, size }: { id: PortraitId; expression: TalkExpression; flip: boolean; size: number }) {
  const col = COL[expression];
  const row = ROW[id];
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', transform: flip ? [{ scaleX: -1 }] : undefined }}>
      <Image
        source={sheet}
        resizeMode="stretch"
        accessibilityIgnoresInvertColors
        style={{
          position: 'absolute',
          width: size * COLS,
          height: size * ROWS,
          left: -col * size,
          top: -row * size,
        }}
      />
    </View>
  );
}
