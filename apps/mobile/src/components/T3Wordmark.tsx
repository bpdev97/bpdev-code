import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The Tangent "T" brand mark. The legacy component name is retained to keep
 * this fork's branding diff small and easy to carry across upstream updates.
 */
export function T3Wordmark(props: { readonly height: number; readonly color: ColorValue }) {
  const aspectRatio = 48.8 / 56.96;
  return (
    <Svg
      accessibilityLabel="T"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="15.5309 37 48.8 56.96"
    >
      <Path d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509Z" fill={props.color} />
    </Svg>
  );
}
