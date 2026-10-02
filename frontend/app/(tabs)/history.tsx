import Feather from "@react-native-vector-icons/feather";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, dequeueCapture, getQueue, QueuedCapture, SavedQuote } from "@/src/api";
import { CanvasRenderer } from "@/src/components/CanvasRenderer";
import { Button, ScreenTitle } from "@/src/components/ui";
import { usesNativeTabs } from "@/src/navigation";
import { toast, useDraft } from "@/src/store";
import { getTemplate } from "@/src/templates";
import { makeStyles, useTheme } from "@/src/theme";

const EMPTY_IMAGE =
  "https://images.unsplash.com/photo-1529589941132-43606325dfb4?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NTZ8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwYm9vayUyMG9wZW4lMjB0ZXh0JTIwYWVzdGhldGljfGVufDB8fHx8MTc5MDg5OTI5NXww&ixlib=rb-4.1.0&q=85";

export default function HistoryScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;
  const setDraft = useDraft((s) => s.setDraft);
  const queryClient = useQueryClient();
  const [queue, setQueue] = useState<QueuedCapture[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const quotesQuery = useQuery({ queryKey: ["quotes"], queryFn: api.listQuotes });

  useFocusEffect(
    useCallback(() => {
      getQueue().then(setQueue);
    }, []),
  );

  const deleteMutation = useMutation({
    mutationFn: api.deleteQuote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast("Quote removed.", "success");
    },
    onError: () => toast("Couldn't delete the quote.", "error"),
  });

  const openQuote = (q: SavedQuote) => {
    setDraft({
      id: q.id,
      ocrText: q.raw_text,
      bookTitle: q.book_title ?? "",
      author: q.author ?? "",
      selectedTemplate: q.template_used,
      aspectRatio: q.aspect_ratio ?? "4:5",
    });
    router.push("/editor");
  };

  const processQueued = async (item: QueuedCapture) => {
    setProcessingId(item.id);
    try {
      const res = await api.ocr(item.base64);
      if (!res.ok) {
        toast(res.message ?? "Text unclear. Please try capturing again in better light.", "error");
        await dequeueCapture(item.id);
        setQueue(await getQueue());
        return;
      }
      await dequeueCapture(item.id);
      setQueue(await getQueue());
      setDraft({ id: null, ocrText: res.text.slice(0, 500), bookTitle: "", author: "", selectedTemplate: "minimalist-dark", aspectRatio: "4:5" });
      router.push("/editor");
    } catch {
      toast("Still offline or server unreachable. Try again later.", "error");
    } finally {
      setProcessingId(null);
    }
  };

  const cardW = (width - 24 * 2 - 16) / 2;
  const quotes = quotesQuery.data ?? [];

  const header = (
    <View>
      <ScreenTitle title="Your clippings" subtitle={quotes.length ? `${quotes.length} saved quote${quotes.length === 1 ? "" : "s"}` : undefined} testID="history-title" />
      {queue.length ? (
        <View testID="unprocessed-queue" style={styles.queue}>
          <View style={styles.queueHeader}>
            <Feather name="wifi-off" size={16} color={colors.onBrandTertiary} />
            <Text style={styles.queueTitle}>Unprocessed captures ({queue.length})</Text>
          </View>
          {queue.map((item) => (
            <View key={item.id} style={styles.queueRow}>
              <Image source={{ uri: item.uri }} style={styles.queueThumb} contentFit="cover" />
              <Text style={styles.queueDate}>{new Date(item.created_at).toLocaleString()}</Text>
              <Button
                testID={`queue-process-${item.id}`}
                label="Extract"
                variant="secondary"
                onPress={() => processQueued(item)}
                loading={processingId === item.id}
                style={{ minHeight: 40, paddingHorizontal: 14 }}
              />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  if (quotesQuery.isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View testID="history-skeleton" style={styles.grid}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={[styles.skeletonCard, { width: cardW, height: cardW * 1.25 }]} />
          ))}
        </View>
      </View>
    );
  }

  if (quotesQuery.isError) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        {header}
        <View testID="history-error" style={styles.center}>
          <Text style={styles.errorText}>Couldn't load your history.</Text>
          <Button testID="history-retry-button" label="Retry" variant="ghost" onPress={() => quotesQuery.refetch()} />
        </View>
      </View>
    );
  }

  if (!quotes.length && !queue.length) {
    return (
      <View testID="history-empty" style={styles.empty}>
        <Image source={{ uri: EMPTY_IMAGE }} style={styles.emptyImage} contentFit="cover" transition={300} />
        <LinearGradient colors={["transparent", colors.surfaceInverse]} locations={[0, 0.72]} style={styles.emptyImage} />
        <View style={[styles.emptyContent, { paddingBottom: bottomChrome + 32, paddingTop: insets.top }]}>
          <Text style={styles.emptyTitle}>No quotes saved yet.</Text>
          <Text style={styles.emptyBody}>Snap a page, crop the passage, and your styled quotes will collect here.</Text>
          <Button testID="history-scan-button" label="Scan a quote" icon="camera" onPress={() => router.navigate("/(tabs)")} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <FlatList
        testID="history-list"
        data={quotes}
        keyExtractor={(q) => q.id}
        numColumns={2}
        ListHeaderComponent={header}
        columnWrapperStyle={styles.row}
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: bottomChrome + 24 }}
        refreshControl={<RefreshControl refreshing={quotesQuery.isRefetching} onRefresh={() => quotesQuery.refetch()} tintColor={colors.brandPrimary} />}
        renderItem={({ item }) => {
          const t = getTemplate(item.template_used);
          return (
            <Pressable
              testID={`history-card-${item.id}`}
              onPress={() => openQuote(item)}
              onLongPress={() => deleteMutation.mutate(item.id)}
              style={({ pressed }) => [styles.card, { width: cardW }, pressed && { opacity: 0.85 }]}
            >
              <View style={{ pointerEvents: "none" }}>
                <CanvasRenderer text={item.raw_text} bookTitle={item.book_title ?? ""} author={item.author ?? ""} template={t} aspectRatio="4:5" width={cardW} compact />
              </View>
              <View style={styles.cardMeta}>
                <Text numberOfLines={1} style={styles.cardTitle}>
                  {item.book_title || "Untitled"}
                </Text>
                <View style={styles.cardMetaRow}>
                  <Text numberOfLines={1} style={styles.cardSub}>
                    {item.author || new Date(item.created_at).toLocaleDateString()}
                  </Text>
                  <Pressable testID={`history-delete-${item.id}`} hitSlop={10} onPress={() => deleteMutation.mutate(item.id)}>
                    <Feather name="trash-2" size={16} color={colors.muted} />
                  </Pressable>
                </View>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 24 },
  skeletonCard: { backgroundColor: colors.surfaceTertiary, borderRadius: 2 },
  row: { gap: 16, marginBottom: 20 },
  card: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, borderRadius: 2, overflow: "hidden" },
  cardMeta: { padding: 10, gap: 2 },
  cardTitle: { fontFamily: "Cormorant", fontSize: 17, color: colors.onSurfaceSecondary },
  cardMetaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardSub: { fontFamily: "DMSans", fontSize: 12, color: colors.muted, flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  errorText: { fontFamily: "DMSans", fontSize: 15, color: colors.onSurface },
  queue: { marginHorizontal: 24, marginBottom: 20, backgroundColor: colors.brandTertiary, padding: 16, borderRadius: 4, gap: 12 },
  queueHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  queueTitle: { fontFamily: "DMSans", fontSize: 13, fontWeight: "600", color: colors.onBrandTertiary },
  queueRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  queueThumb: { width: 44, height: 44, borderRadius: 2, backgroundColor: colors.surfaceTertiary },
  queueDate: { flex: 1, fontFamily: "DMSans", fontSize: 12, color: colors.onBrandTertiary },
  empty: { flex: 1, backgroundColor: colors.surfaceInverse },
  emptyImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  emptyContent: { flex: 1, justifyContent: "flex-end", paddingHorizontal: 24, gap: 12 },
  emptyTitle: { fontFamily: "Cormorant", fontSize: 40, lineHeight: 44, color: colors.onSurfaceInverse },
  emptyBody: { fontFamily: "DMSans", fontSize: 15, lineHeight: 22, color: colors.onSurfaceInverse, opacity: 0.85, marginBottom: 12 },
}));
