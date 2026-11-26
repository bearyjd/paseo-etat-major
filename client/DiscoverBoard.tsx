import { Pressable, Text, View } from "react-native";
import { Button, Pill } from "./controls.tsx";
import type { DecisionRow, DiscoverVm, ResearchRow } from "./discover-view-model.ts";
import type { Styles } from "./styles.ts";

// Stateless: section and selection come from the caller. Every payload string arrives already
// sanitized from discover-view-model.ts and is rendered as plain Text; source URLs included.

export type DiscoverSection = "decisions" | "research";

function DecisionStatus({ styles, row }: { styles: Styles; row: DecisionRow }) {
  return (
    <Text style={row.tone === "rejected" ? styles.text.dangerStrong : row.tone === "pending" ? styles.text.warningStrong : styles.text.strong}>
      {row.statusText}
    </Text>
  );
}

function ResearchTrust({ styles, row }: { styles: Styles; row: ResearchRow }) {
  return (
    <View style={styles.tight}>
      <Text style={row.needsCheck ? styles.text.warningStrong : styles.text.strong}>{row.statusText}</Text>
      <Text style={row.needsCheck ? styles.text.warning : styles.text.muted}>{row.provenanceText}</Text>
    </View>
  );
}

function Notes({ styles, features, omitted }: { styles: Styles; features: readonly string[]; omitted: readonly string[] }) {
  return (
    <View style={styles.tight}>
      {features.length === 0 ? null : <Text style={styles.text.muted}>{`Features: ${features.join(", ")}`}</Text>}
      {omitted.map((line) => <Text key={line} style={styles.text.warning}>{line}</Text>)}
    </View>
  );
}

function DecisionDetail({ styles, row }: { styles: Styles; row: DecisionRow }) {
  return (
    <View style={styles.stack}>
      <View style={row.tone === "rejected" ? styles.rowDanger : row.tone === "pending" ? styles.rowWarning : styles.taskRow}>
        <DecisionStatus styles={styles} row={row} />
        <Text style={styles.text.detailTitle}>{row.question}</Text>
        <Text style={styles.text.muted}>{`${row.id} · ${row.dateText}`}</Text>
      </View>
      {row.chosen === null ? null : (
        <View style={styles.card}>
          <Text style={styles.text.strong}>Chosen</Text>
          <Text style={styles.text.body}>{row.chosen}</Text>
        </View>
      )}
      {row.rationale === null ? null : (
        <View style={styles.card}>
          <Text style={styles.text.strong}>Rationale</Text>
          <Text style={styles.text.body}>{row.rationale}</Text>
        </View>
      )}
      {row.alternatives.length === 0 ? null : <Text style={styles.text.heading}>Alternatives not taken</Text>}
      {row.alternatives.map((a, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.text.strong}>{a.option}</Text>
          <Text style={styles.text.body}>{a.whyNot}</Text>
        </View>
      ))}
      <Text style={styles.text.heading}>Evidence</Text>
      <Text style={row.evidenceNeedsCheck ? styles.text.warning : styles.text.muted}>{row.evidenceText}</Text>
      {row.cites.map((c) => (
        <View key={c.key} style={c.needsCheck ? styles.cardWarning : styles.card}>
          <Text style={styles.text.strong}>{c.ref}</Text>
          <Text style={c.needsCheck ? styles.text.warning : styles.text.body}>{c.detail}</Text>
        </View>
      ))}
      <Notes styles={styles} features={row.features} omitted={row.omitted} />
    </View>
  );
}

function ResearchDetail({ styles, row }: { styles: Styles; row: ResearchRow }) {
  return (
    <View style={styles.stack}>
      <View style={row.needsCheck ? styles.cardWarning : styles.card}>
        <ResearchTrust styles={styles} row={row} />
        <Text style={styles.text.detailTitle}>{row.title}</Text>
        <Text style={styles.text.muted}>{`${row.id} · ${row.project} · ${row.findingsText}`}</Text>
      </View>
      {row.findings.map((f) => (
        <View key={f.key} style={f.unsourced ? styles.cardWarning : styles.card}>
          <Text style={styles.text.muted}>{f.id}</Text>
          <Text style={styles.text.body}>{f.text}</Text>
          {f.unsourced ? <Pill styles={styles} text="unsourced" /> : null}
          {f.sourceUrl === null ? null : <Text selectable style={styles.text.muted}>{f.sourceUrl}</Text>}
          {f.sourceDate === null ? null : <Text style={styles.text.muted}>{`Source date ${f.sourceDate}`}</Text>}
        </View>
      ))}
      <Notes styles={styles} features={row.features} omitted={row.omitted} />
    </View>
  );
}

function DecisionList({ styles, rows, onSelect }: { styles: Styles; rows: readonly DecisionRow[]; onSelect: (key: string) => void }) {
  if (rows.length === 0) return <Text style={styles.text.muted}>No decisions recorded.</Text>;
  return (
    <View style={styles.tight}>
      {rows.map((d) => (
        <Pressable key={d.key} accessibilityRole="button" accessibilityLabel={`${d.statusText}. ${d.question}. ${d.evidenceText}`} onPress={() => onSelect(d.key)} style={d.tone === "rejected" ? styles.rowDanger : d.tone === "pending" ? styles.rowWarning : styles.taskRow}>
          <DecisionStatus styles={styles} row={d} />
          <Text style={styles.text.body}>{d.question}</Text>
          <Text style={d.evidenceNeedsCheck ? styles.text.warning : styles.text.muted}>{d.evidenceText}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ResearchList({ styles, rows, onSelect }: { styles: Styles; rows: readonly ResearchRow[]; onSelect: (key: string) => void }) {
  if (rows.length === 0) return <Text style={styles.text.muted}>No research recorded.</Text>;
  return (
    <View style={styles.tight}>
      {rows.map((r) => (
        <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={`${r.title}. ${r.statusText}. ${r.provenanceText}. ${r.findingsText}`} onPress={() => onSelect(r.key)} style={r.needsCheck ? styles.rowWarning : styles.taskRow}>
          <Text style={styles.text.strong}>{r.title}</Text>
          <ResearchTrust styles={styles} row={r} />
          <Text style={styles.text.muted}>{r.findingsText}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface DiscoverBoardProps {
  readonly styles: Styles;
  readonly vm: DiscoverVm;
  readonly section: DiscoverSection;
  readonly selected: string | null;
  readonly onSection: (section: DiscoverSection) => void;
  readonly onSelect: (key: string | null) => void;
}

export function DiscoverBoard({ styles, vm, section, selected, onSection, onSelect }: DiscoverBoardProps) {
  const decision = section === "decisions" ? vm.decisions.find((d) => d.key === selected) : undefined;
  const research = section === "research" ? vm.research.find((r) => r.key === selected) : undefined;
  if (decision || research) {
    return (
      <View style={styles.stack}>
        <Button styles={styles} label="Back to list" onPress={() => onSelect(null)} />
        {decision ? <DecisionDetail styles={styles} row={decision} /> : <ResearchDetail styles={styles} row={research!} />}
      </View>
    );
  }
  const tabs: readonly (readonly [DiscoverSection, string])[] = [["decisions", vm.decisionsLabel], ["research", vm.researchLabel]];
  return (
    <View style={styles.loose}>
      <View accessibilityRole="tablist" style={styles.row}>
        {tabs.map(([id, text]) => (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: id === section }} onPress={() => onSection(id)} style={id === section ? styles.tabSelected : styles.tab}>
            <Text style={id === section ? styles.text.tabSelected : styles.text.tab}>{text}</Text>
          </Pressable>
        ))}
      </View>
      {section === "decisions" ? <DecisionList styles={styles} rows={vm.decisions} onSelect={onSelect} /> : <ResearchList styles={styles} rows={vm.research} onSelect={onSelect} />}
    </View>
  );
}
