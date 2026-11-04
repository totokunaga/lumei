import {
  Canvas,
  Circle,
  Group,
  Image,
  Paint,
  Path,
  Skia,
  type SkPath,
  useImage,
} from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useColorScheme, View } from 'react-native';
import {
  ReduceMotion,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import {
  type Box,
  cameraFor,
  countriesPath,
  disputedDots,
  disputedPath,
  landPath,
  regionBox,
  WORLD,
  WORLD_BOX,
} from '@/domain/map';

import { EASE_IN_OUT, EASE_OUT } from './motion';
import { RELIEF_TILES } from './relief-tiles';

/** Props of `RegionMap`. */
interface RegionMapProps {
  /** The region's countries, as ISO 3166-1 alpha-2 codes; none shows the whole world. */
  countries: readonly string[];
  /** What the map shows, for screen readers, e.g. "Map of Japan". */
  label: string;
}

const camera = { duration: 700, easing: EASE_IN_OUT, reduceMotion: ReduceMotion.System };
const fade = { duration: 300, easing: EASE_OUT, reduceMotion: ReduceMotion.System };

/** The region's color: emerald-600, a deeper green than the app's accent so it reads over the terrain. */
const REGION = '#059669';

/** The disputed areas' color: green-300, a lighter, yellower green than the region's. */
const DISPUTED = '#86EFAC';

/** The paths every map draws, parsed once. */
let shapes: { land: SkPath; lakes: SkPath | null; disputed: SkPath | null } | null = null;

/**
 * Parses the land's, the lakes', and the disputed areas' paths the first
 * time they are needed.
 * @returns The path of every country joined, of the large lakes, and of the disputed areas.
 */
const landShapes = () => {
  shapes ??= {
    land: Skia.Path.MakeFromSVGString(landPath())!,
    lakes: Skia.Path.MakeFromSVGString(WORLD.lakes),
    disputed: Skia.Path.MakeFromSVGString(disputedPath()),
  };
  return shapes;
};

/** Where the disputed islands too small to outline get a dot. */
const dots = disputedDots();

/**
 * Renders a world map with the region's countries in the accent color,
 * framed on their mainlands (BR-SET-06). Only the region's countries show
 * borders; the rest of the land is one silhouette. Shaded relief over the
 * land shows the terrain, e.g. the Alps and Japan's mountains, sharper in
 * each region's own tile. Disputed areas that a region's country is party
 * to (e.g. the Northern Territories) are light green, with a dot for islands too
 * small to see. "Other", which has no countries, shows none. When the region changes,
 * the camera glides to the new one and its countries fade in, on the UI
 * thread. It opens on the whole world and then zooms to the region. With
 * Reduce Motion on, it jumps instead.
 */
export function RegionMap({ countries, label }: RegionMapProps) {
  const dark = useColorScheme() === 'dark';
  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);
  const key = countries.join(',');
  const highlighted = useMemo(
    () => Skia.Path.MakeFromSVGString(countriesPath(key ? key.split(',') : [])),
    [key],
  );

  const scale = useSharedValue(0);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const opacity = useSharedValue(0);
  const shown = useRef(false);

  useEffect(() => {
    if (!viewport) {
      return;
    }
    const target = cameraFor(regionBox(key ? key.split(',') : []), viewport);
    if (!shown.current) {
      // Start on the whole world, then zoom in, so the user sees where the region is.
      shown.current = true;
      const start = cameraFor(WORLD_BOX, viewport);
      scale.set(start.scale);
      x.set(start.x);
      y.set(start.y);
      scale.set(withDelay(250, withTiming(target.scale, camera)));
      x.set(withDelay(250, withTiming(target.x, camera)));
      y.set(withDelay(250, withTiming(target.y, camera)));
    } else {
      scale.set(withTiming(target.scale, camera));
      x.set(withTiming(target.x, camera));
      y.set(withTiming(target.y, camera));
    }
    opacity.set(0);
    opacity.set(withTiming(1, fade));
  }, [key, viewport, scale, x, y, opacity]);

  const transform = useDerivedValue(() => [
    { translateX: x.get() },
    { translateY: y.get() },
    { scale: scale.get() || 1 },
  ]);
  // Borders stay one point wide, and dots 2.5 points across, at any zoom.
  const border = useDerivedValue(() => 1 / (scale.get() || 1));
  const dot = useDerivedValue(() => 1.25 / (scale.get() || 1));
  // "Other" has no countries, so no country of its is party to a dispute.
  const disputes = key !== '';

  const sea = dark ? '#030712' : '#F9FAFB';

  return (
    <View style={{ backgroundColor: sea }} className="h-56 overflow-hidden rounded-3xl">
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        onLayout={({ nativeEvent: { layout } }) =>
          setViewport({ width: layout.width, height: layout.height })
        }
        className="flex-1"
      >
        {viewport && (
          <Canvas style={{ flex: 1 }}>
            <Group transform={transform}>
              <Path path={landShapes().land} color={dark ? '#1F2937' : '#D1D5DB'} />
              {highlighted && <Path path={highlighted} color={REGION} opacity={opacity} />}
              {disputes && landShapes().disputed && (
                <Path path={landShapes().disputed!} color={DISPUTED} />
              )}
              {/* The tiles are drawn into one layer, sharper ones over the world's, which
                  is then laid over the land. Flat ground is mid-grey in the relief, which
                  overlay leaves as it is. */}
              <Group clip={landShapes().land} layer={<Paint blendMode="overlay" />}>
                {RELIEF_TILES.map((tile) => (
                  <ReliefTile key={tile.box.x0} source={tile.image} box={tile.box} />
                ))}
              </Group>
              {landShapes().lakes && <Path path={landShapes().lakes!} color={sea} />}
              {highlighted && (
                <Path
                  path={highlighted}
                  color={sea}
                  style="stroke"
                  strokeWidth={border}
                  strokeJoin="round"
                  opacity={opacity}
                />
              )}
              {disputes &&
                dots.map(({ x: cx, y: cy }) => (
                  <Circle key={`${cx},${cy}`} cx={cx} cy={cy} r={dot} color={DISPUTED} />
                ))}
            </Group>
          </Canvas>
        )}
      </View>
    </View>
  );
}

/**
 * Renders one image of shaded relief over the box of the map it covers,
 * once it has loaded (see `RELIEF_TILES`).
 */
function ReliefTile({ source, box }: { source: number; box: Box }) {
  const image = useImage(source);
  return (
    image && (
      <Image
        image={image}
        x={box.x0}
        y={box.y0}
        width={box.x1 - box.x0}
        height={box.y1 - box.y0}
        fit="fill"
      />
    )
  );
}
