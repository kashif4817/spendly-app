/**
 * A drop-in replacement for <KeyboardAvoidingView> that works.
 *
 * WHY IT HAS TO EXIST: React Native's own one pads by the keyboard event's
 * `screenY`, and on Android that value is the bottom of the WINDOW'S VISIBLE
 * FRAME. Under edge-to-edge — which Expo SDK 54 makes mandatory, with no way
 * to opt out — the window no longer shrinks when the keyboard opens, so
 * `screenY` keeps reporting the bottom of the screen and the padding comes
 * out as zero. That is why every form in this app was written as
 *
 *     behavior={Platform.OS === 'ios' ? 'padding' : undefined}
 *
 * which is an honest admission that the Android half never worked.
 *
 * This uses `endCoordinates.height` instead, which React Native reads
 * straight off the IME window inset and is therefore right either way. On
 * Android that height EXCLUDES the navigation bar (it is the ime inset less
 * the system-bar inset), so the safe-area bottom goes back on; iOS already
 * reports the whole keyboard, home indicator included.
 *
 * HOW IT AVOIDS: by shrinking, not by scrolling. The padding takes the
 * keyboard's height off the bottom of this view, which means any ScrollView
 * inside it gets shorter — and Android's ScrollView scrolls whatever has
 * focus back into view when its size changes. So the field you are typing in
 * comes up on its own, with no ref juggling and nothing to keep in sync.
 *
 * WHERE TO PUT IT: around the part of the screen that reaches the bottom
 * edge, usually just inside the screen's <ThemedView>. The maths assumes this
 * view's bottom IS the bottom of the window, which is true for a full-height
 * form and for anything inside a full-screen <Modal>.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Keyboard, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function KeyboardAvoider({
  children,
  style,
  /**
   * Extra room above the keyboard. For a form whose last control sits flush
   * with the bar, a few points stop it touching.
   */
  extra = 0,
  enabled = true,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  extra?: number;
  enabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [lift, setLift] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLift(0);
      return;
    }

    // iOS reports `will` ahead of the animation, so the view travels with the
    // keyboard; Android only has `did`, which lands a frame later.
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (event) => {
      const covered =
        event.endCoordinates.height + (Platform.OS === 'android' ? insets.bottom : 0);
      setLift(covered > 0 ? covered + extra : 0);
    });

    const hide = Keyboard.addListener(hideEvent, () => setLift(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled, extra, insets.bottom]);

  return <View style={[style, { paddingBottom: lift }]}>{children}</View>;
}
