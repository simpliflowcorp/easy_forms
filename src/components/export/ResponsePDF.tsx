// components/ResponsePDF.tsx
const {
  Page,
  Text,
  View,
  Document,
  StyleSheet,
} = require("@react-pdf/renderer");
const styles = StyleSheet.create({
  page: { padding: 30 },
  header: { fontSize: 24, marginBottom: 20 },
  row: { flexDirection: "row", borderBottom: 1, paddingVertical: 5 },
  cell: { flex: 1, paddingHorizontal: 5 },
});

export default function ResponsePDF({ responses, headers }: any) {
  return (
    <Document>
      <Page style={styles.page}>
        <Text style={styles.header}>Form Responses</Text>

        {/* Headers */}
        <View style={styles.row}>
          {headers.map((header: string) => (
            <Text key={header} style={styles.cell}>
              {header}
            </Text>
          ))}
        </View>

        {/* Rows */}
        {responses.map((response: any, index: number) => (
          <View key={index} style={styles.row}>
            {headers.map((header: string) => (
              <Text key={header} style={styles.cell}>
                {response[header] || "-"}
              </Text>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
