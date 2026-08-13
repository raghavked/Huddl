import Feather from "@expo/vector-icons/Feather";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MagnifyingGlass, Mug } from "@/components/illustrations";
import {
  AppText,
  Button,
  Chip,
  EmptyState,
  Field,
  Skeleton,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  BOARD_BODY_MAX,
  BOARD_TITLE_MAX,
  BOARD_TITLE_MIN,
  BoardError,
  CATEGORIES,
  asBoardCategory,
  categoryInfo,
  createPost,
  fetchPost,
  isMine,
  parseBoardDay,
  priceCentsFrom,
  priceLabel,
  toBoardDay,
  updatePost,
  type BoardCategory,
} from "@/lib/board";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";

/* Putting something on the board, and with an `id` param, editing it.
 *
 * One screen for both because `updatePost` takes the same whole-composer
 * shape `createPost` does: an edit is a re-save, not a patch, so a post that
 * stops being for sale can't keep a price nobody meant to leave on it. The
 * two paths differ in three places: where the fields start, what the button
 * says, and where you land afterwards.
 *
 * The category comes first and the rest of the form follows it. Every
 * category takes a title and details; `wantsPrice` and `wantsDate` from
 * `@/lib/board` decide whether the price and the leaving-day fields are
 * offered at all, and a field that isn't offered isn't sent. Switch a post
 * from "for sale" to "lost" and the price goes with it.
 *
 * Nothing here re-derives the board's vocabulary: the chips, the icons, and
 * the question in the details placeholder all come from `CATEGORIES`.
 */

/** Start warning about the details cap this late. Earlier is just nagging. */
const COUNT_VISIBLE_FROM = 1300;

/** How many days a month has, the calendar screens' own day check. */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** What the details field asks before a category has been chosen. */
const NEUTRAL_PLACEHOLDER = "What should people know?";

type EditStatus = "loading" | "error" | "missing" | "notMine" | "ready";

export default function BoardComposerScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const myId = session?.user.id ?? null;

  const params = useLocalSearchParams<{ category?: string; id?: string }>();
  const postId =
    typeof params.id === "string" && params.id.trim().length > 0
      ? params.id.trim()
      : null;
  const editing = postId !== null;

  const [category, setCategory] = useState<BoardCategory | null>(() =>
    asBoardCategory(params.category)
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [price, setPrice] = useState("");
  const [day, setDay] = useState("");

  const [priceError, setPriceError] = useState<string | null>(null);
  const [dayError, setDayError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [editStatus, setEditStatus] = useState<EditStatus>(
    editing ? "loading" : "ready"
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/board");
  }, []);

  /** Fill the form from the post being edited. Only runs in edit mode. */
  const loadPost = useCallback(async () => {
    if (postId === null) return;
    setEditStatus("loading");
    try {
      const post = await fetchPost(postId);
      if (!post) {
        setEditStatus("missing");
        return;
      }
      if (!isMine(post, myId)) {
        setEditStatus("notMine");
        return;
      }
      setCategory(post.category);
      setTitle(post.title);
      setBody(post.body ?? "");
      // Dollars in the field, cents in the column. `priceLabel` is the one
      // place that division happens, and it prints "Free" at zero, which is
      // not something you can type back in. Zero seeds as "0".
      setPrice(
        post.price_cents === null
          ? ""
          : post.price_cents === 0
            ? "0"
            : (priceLabel(post.price_cents)?.replace(/[$,]/g, "") ?? "")
      );
      // Round-trip through the matched pair rather than trusting the string:
      // anything that isn't a real calendar day comes back as a blank field.
      const parsed = parseBoardDay(post.happens_on);
      setDay(parsed ? toBoardDay(parsed) : "");
      setEditStatus("ready");
    } catch {
      setEditStatus("error");
    }
  }, [postId, myId]);

  useEffect(() => {
    if (!editing) return;
    void loadPost();
  }, [editing, loadPost]);

  const info = category !== null ? categoryInfo(category) : null;

  const pickCategory = useCallback((next: BoardCategory) => {
    setCategory(next);
    setFormError(null);
    // A field that's no longer on screen shouldn't keep an error under it.
    setPriceError(null);
    setDayError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (pending || category === null || info === null) return;
    setFormError(null);
    setPriceError(null);
    setDayError(null);

    /* The leaving day, checked exactly the way the calendar screens check a
       date, so the whole app rejects "2026-02-31" with the same sentence. */
    let happensOn: Date | null = null;
    if (info.wantsDate && day.trim().length > 0) {
      const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(day.trim());
      if (!match) {
        setDayError("Dates look like YYYY-MM-DD, as in 2026-10-14.");
        return;
      }
      const year = Number(match[1]);
      const month = Number(match[2]);
      const date = Number(match[3]);
      if (month < 1 || month > 12 || date < 1 || date > daysInMonth(month, year)) {
        setDayError("That day doesn't exist. Double-check the month and day.");
        return;
      }
      happensOn = new Date(year, month - 1, date);
    }

    /* Cents, built by the library rather than by multiplying a float here. */
    let priceCents: number | null = null;
    if (info.wantsPrice) {
      try {
        priceCents = priceCentsFrom(price);
      } catch (caught) {
        setPriceError(
          caught instanceof BoardError
            ? caught.message
            : "Write the price as a number: 45, or 45.50."
        );
        return;
      }
    }

    setPending(true);
    try {
      // Only what this composer actually offered gets sent: the two optional
      // columns are cleared by omission when the category doesn't want them.
      const input = { category, title, body, priceCents, happensOn };
      if (postId !== null) {
        await updatePost(postId, input);
        tapSuccess();
        goBack();
        return;
      }
      const post = await createPost(input);
      // It's on the board, so that's the completion moment.
      tapSuccess();
      router.replace(`/board/${post.id}`);
    } catch (caught) {
      setFormError(
        caught instanceof BoardError
          ? caught.message
          : "That didn't post just now. Give it another go."
      );
    } finally {
      setPending(false);
    }
  }, [pending, category, info, day, price, postId, title, body, goBack]);

  // A deep link can land here signed out, so send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const scaffold = (children: React.ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        <View style={{ paddingHorizontal: space.close }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={goBack}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="chevron-left" size={26} color={theme.foreground} />
          </Pressable>
        </View>
        {children}
      </View>
    </KeyboardAvoidingView>
  );

  if (editStatus === "loading") {
    /* The composer's shape is entirely predictable: a title, the rail of
       category chips, then the two fields every category asks for. So the
       form draws itself in grey and the words fill in. */
    return scaffold(
      <View style={{ paddingHorizontal: space.gutter, gap: space.card }}>
        <View style={{ gap: space.cosy }}>
          <Skeleton width="64%" height={30} />
          <Skeleton width="88%" height={11} radius={radius.full} />
        </View>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
        >
          {[66, 54, 62, 58, 74, 52].map((width) => (
            <Skeleton
              key={width}
              width={width}
              height={30}
              radius={radius.full}
            />
          ))}
        </View>
        <View style={{ gap: space.cosy }}>
          <Skeleton width={40} height={11} radius={radius.full} />
          <Skeleton height={46} />
        </View>
        <View style={{ gap: space.cosy }}>
          <Skeleton width={54} height={11} radius={radius.full} />
          <Skeleton height={140} />
        </View>
      </View>
    );
  }

  if (editStatus === "error") {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.room,
          paddingHorizontal: space.rest,
          paddingBottom: 60,
        }}
      >
        <Feather name="cloud-off" size={28} color={theme.muted} />
        <AppText variant="bodySemi">Something hiccuped</AppText>
        <AppText
          variant="caption"
          muted
          style={{ textAlign: "center", maxWidth: 280 }}
        >
          We couldn't open that post to edit it. Check your connection and give
          it another go.
        </AppText>
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => void loadPost()}
        />
      </View>
    );
  }

  if (editStatus === "missing" || editStatus === "notMine") {
    return scaffold(
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          /* A post that isn't there is a search that came back empty; a post
             that isn't yours is nobody's problem. Two different moods. */
          illustration={editStatus === "missing" ? MagnifyingGlass : Mug}
          title={
            editStatus === "missing"
              ? "That post isn't there"
              : "That one isn't yours"
          }
          body={
            editStatus === "missing"
              ? "It may have already come down. The board has everything that's still up."
              : "Only the person who put a post up can change it. You can still message them from the post itself."
          }
          action={{ label: "Back to the board", onPress: goBack }}
        />
      </View>
    );
  }

  const remaining = BOARD_BODY_MAX - body.length;
  const canSubmit =
    category !== null && title.trim().length >= BOARD_TITLE_MIN;

  return scaffold(
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: space.gutter,
        paddingBottom: insets.bottom + space.rest,
        gap: space.card,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: space.snug }}>
        <AppText variant="display">
          {editing ? "Edit your post" : "Post to the board"}
        </AppText>
        <AppText variant="caption" muted>
          Everyone on campus can read this, and anyone can message you about
          it.
        </AppText>
      </View>

      <View style={{ gap: space.cosy }}>
        <AppText variant="label">What is it?</AppText>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
        >
          {CATEGORIES.map((entry) => (
            <Chip
              key={entry.key}
              label={entry.label}
              icon={entry.icon}
              tone="brand"
              size="md"
              selected={category === entry.key}
              onPress={() => pickCategory(entry.key)}
            />
          ))}
        </View>
        {category === null ? (
          <AppText variant="caption" muted>
            Pick one. It changes what we ask for next.
          </AppText>
        ) : null}
      </View>

      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Say it in a few words"
        maxLength={BOARD_TITLE_MAX}
        editable={!pending}
        returnKeyType="next"
      />

      <View style={{ gap: space.snug }}>
        <Field
          label="Details"
          value={body}
          onChangeText={setBody}
          /* The question the board asks about this kind of post. The hardest
             part of posting is knowing which detail the reader needs. */
          placeholder={info?.placeholder ?? NEUTRAL_PLACEHOLDER}
          maxLength={BOARD_BODY_MAX}
          multiline
          editable={!pending}
          style={{ minHeight: 140, textAlignVertical: "top" }}
        />
        {body.length > COUNT_VISIBLE_FROM ? (
          remaining > 0 ? (
            <AppText variant="caption" muted style={{ alignSelf: "flex-end" }}>
              {remaining} characters left
            </AppText>
          ) : (
            <AppText
              variant="caption"
              style={{ alignSelf: "flex-end", color: theme.danger }}
            >
              That's the full {BOARD_BODY_MAX} characters. Swap the rest in a
              message.
            </AppText>
          )
        ) : null}
      </View>

      {info?.wantsPrice ? (
        <View style={{ gap: space.snug }}>
          <Field
            label="Price"
            value={price}
            onChangeText={(text) => {
              setPrice(text);
              if (priceError) setPriceError(null);
            }}
            placeholder="45"
            keyboardType="decimal-pad"
            maxLength={10}
            editable={!pending}
            error={priceError}
          />
          <AppText variant="caption" muted>
            {category === "ride"
              ? "Gas money, if you're asking for any. Leave it blank if you're not."
              : "Leave it blank if there isn't one, or put 0 to say it's free."}
          </AppText>
        </View>
      ) : null}

      {info?.wantsDate ? (
        <View style={{ gap: space.snug }}>
          <Field
            label="Day you're leaving"
            value={day}
            onChangeText={(text) => {
              setDay(text);
              if (dayError) setDayError(null);
            }}
            placeholder="2026-10-14"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!pending}
            error={dayError}
          />
          <AppText variant="caption" muted>
            Optional, but it's the first thing anyone looks for.
          </AppText>
        </View>
      ) : null}

      {formError ? (
        <AppText variant="caption" style={{ color: theme.danger }}>
          {formError}
        </AppText>
      ) : null}

      <Button
        label={
          pending
            ? editing
              ? "Saving…"
              : "Posting…"
            : editing
              ? "Save changes"
              : "Put it on the board"
        }
        pending={pending}
        disabled={!canSubmit}
        icon={
          <Feather
            name={editing ? "check" : "plus"}
            size={16}
            color={theme.brandFg}
          />
        }
        onPress={() => void handleSave()}
        style={{ marginTop: space.tight }}
      />
    </ScrollView>
  );
}
