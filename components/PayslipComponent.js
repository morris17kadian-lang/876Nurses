import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Image,
  Alert,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants';
import PayslipGenerator from '../services/PayslipGenerator';

const PayslipComponent = ({ payslip, onClose, onShare, hideHeader = false }) => {
  if (!payslip) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payslip Management</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text>No payslip data available</Text>
        </View>
      </View>
    );
  }

  const formatCurrency = (amount) => {
    const num = parseFloat(amount || 0);
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const year = date.getFullYear();
    return `${month} ${day}, ${year}`;
  };

  const staffCode = payslip.nurseCode || payslip.code || payslip.employeeId || payslip.staffId || 'N/A';

  // Generate payslip number from ID or employee ID
  const payslipNumber = payslip.payslipNumber || 
    `NUR-PAY-${String(payslip.employeeId || '0001').padStart(4, '0')}`;

  const periodStart = formatDate(payslip.periodStart);
  const periodEnd = formatDate(payslip.periodEnd);
  const generatedDate = formatDate(payslip.generatedDate || new Date().toISOString());
  const [isSharing, setIsSharing] = React.useState(false);

  const handleSharePress = async () => {
    if (isSharing) return;
    setIsSharing(true);
    try {
      console.log('PayslipComponent: Sharing payslip', { payslipNumber, staffName: payslip.staffName });
      const pdfUri = await PayslipGenerator.generatePayslipPDF(payslip);
      await PayslipGenerator.sharePayslip(pdfUri, payslip.staffName || 'Staff');
    } catch (error) {
      console.error('Error generating payslip PDF:', error);
      Alert.alert('Error', 'Failed to generate payslip PDF. Please try again.');
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      {!hideHeader && (
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.white} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Payslip Management</Text>
          <TouchableOpacity style={styles.searchButton}>
            <MaterialCommunityIcons name="magnify" size={24} color={COLORS.white} />
          </TouchableOpacity>
        </View>
      )}

      {/* Preview Header with Action Buttons */}
      <View style={hideHeader ? styles.previewHeaderWide : styles.previewHeader}>
        <TouchableOpacity style={styles.closeIconButton} onPress={onClose} activeOpacity={0.7}>
          <MaterialCommunityIcons name="close" size={18} color={COLORS.white} />
        </TouchableOpacity>
        <Text style={styles.previewTitle}>Payslip Preview - {payslipNumber}</Text>
        {/* PDF Share button disabled as per requirement */}
        {/* <TouchableOpacity style={styles.shareIconButton} onPress={handleSharePress} disabled={isSharing} activeOpacity={0.7}>
          <MaterialCommunityIcons name="file-pdf-box" size={18} color={COLORS.white} />
        </TouchableOpacity> */}
        <View style={styles.shareIconButton} />
      </View>

      <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Payslip Card */}
        <View style={styles.payslipCard}>
          {/* Company Header with Logo */}
          <View style={styles.companyHeader}>
            <View style={styles.companyInfo}>
              <Image
                source={require('../assets/Images/Nurses-logo.png')}
                style={styles.headerLogo}
                resizeMode="contain"
              />
              <Text style={styles.companyDetails}>Phone: (876) 618-9876</Text>
              <Text style={styles.companyDetails}>Email: info@876nurses.com</Text>
            </View>
            <View style={styles.invoiceInfo}>
              <Text style={styles.invoiceLabel}>PAYSLIP</Text>
              <Text style={styles.invoiceNumber}>{payslipNumber}</Text>
              <Text style={styles.dateText}>Generated: {generatedDate}</Text>
              <Text style={styles.dateText}>Period: {periodStart} - {periodEnd}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Pay To Section */}
          <View style={styles.payToSection}>
            <View style={styles.middleFields}>
              <View style={styles.middleFieldCol}>
                <Text style={styles.sectionLabel}>PAY TO:</Text>
                <Text style={styles.payToName}>{payslip.staffName}</Text>
              </View>

              <View style={styles.middleFieldColRight}>
                <Text style={styles.sectionLabel}>STAFF CODE:</Text>
                <Text style={styles.payToName}>{staffCode}</Text>
              </View>
            </View>
          </View>

          {/* Service Description Table */}
          <View style={styles.tableSection}>
            <View style={styles.tableContainer}>
              <View style={styles.tableHeader}>
                <Text style={[styles.tableHeaderText, { flex: 2 }]}>Service Description</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Hours</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Rate</Text>
                <Text style={[styles.tableHeaderText, { flex: 1, textAlign: 'center' }]}>Amount</Text>
              </View>

              {/* Regular Hours Row */}
              {payslip.shiftPay !== undefined && (
                <>
                  {parseFloat(payslip.shiftPay || 0) > 0 && <View style={styles.tableRow}><Text style={[styles.tableCell, { flex: 2 }]}>Completed shifts ({payslip.shiftsCompleted || 0})</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.shiftHours || 0}</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>Shift rates</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.shiftPay)}</Text></View>}
                  {parseFloat(payslip.appointmentPay || 0) > 0 && <View style={styles.tableRow}><Text style={[styles.tableCell, { flex: 2 }]}>Completed appointments</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.appointmentHours || 0}</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{formatCurrency(payslip.hourlyRate)}</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.appointmentPay)}</Text></View>}
                  {parseFloat(payslip.holidayPremium || 0) > 0 && <View style={styles.tableRow}><Text style={[styles.tableCell, { flex: 2 }]}>Public holiday premium</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>—</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>—</Text><Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.holidayPremium)}</Text></View>}
                </>
              )}
              {payslip.shiftPay === undefined && parseFloat(payslip.regularHours || 0) > 0 && (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>Home Care Assistance</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.regularHours}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{formatCurrency(payslip.hourlyRate)}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.regularPay)}</Text>
                </View>
              )}

              {/* Overtime Hours Row if needed */}
              {parseFloat(payslip.overtimeHours || 0) > 0 && (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>Overtime (1.5x)</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.overtimeHours}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{formatCurrency(payslip.hourlyRate * 1.5)}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.overtimePay)}</Text>
                </View>
              )}

              {/* If no regular hours, show total */}
              {parseFloat(payslip.regularHours || 0) === 0 && (
                <View style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]}>{payslip.payType === 'salary' ? 'Salary' : 'Recorded work'}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.hoursWorked || '—'}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center' }]}>{payslip.hourlyRate ? formatCurrency(payslip.hourlyRate) : '—'}</Text>
                  <Text style={[styles.tableCell, { flex: 1, textAlign: 'center', fontWeight: '600' }]}>{formatCurrency(payslip.basePay ?? payslip.grossPay)}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Payment Information */}
          <View style={styles.paymentSection}>
            <View style={styles.totalAndPaidContainer}>
              <View style={styles.totalSection}>
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Base Pay:</Text>
                  <Text style={styles.totalValue}>{formatCurrency(payslip.staffType === 'nursing' ? payslip.regularPay : payslip.basePay)}</Text>
                </View>
                {Object.entries(payslip.allowances || {}).filter(([, amount]) => parseFloat(amount || 0) > 0).map(([name, amount]) => (
                  <View key={name} style={styles.totalRow}>
                    <Text style={styles.totalLabel}>{name.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())} allowance:</Text>
                    <Text style={styles.totalValue}>+{formatCurrency(amount)}</Text>
                  </View>
                ))}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Gross Pay:</Text>
                  <Text style={styles.totalValue}>{formatCurrency(payslip.grossPay)}</Text>
                </View>

                <View style={styles.finalTotalRow}>
                  <Text style={styles.finalTotalLabel}>Net Pay:</Text>
                  <Text style={styles.finalTotalValue}>{formatCurrency(payslip.netPay)}</Text>
                </View>
              </View>

              {payslip.status === 'paid' && (
                <View style={styles.paidInfoBelowTotal}>
                  <Text style={styles.paidDateBelowTotal}>
                    Paid on: {formatDate(payslip.paidDate || payslip.payDate || new Date().toISOString())}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#2196F3',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 15,
    paddingHorizontal: 20,
  },
  backButton: {
    padding: 5,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.white,
  },
  searchButton: {
    padding: 5,
  },
  leftButtonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  closeIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EF5350',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  shareIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2196F3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  buttonText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.white,
  },
  previewHeader: {
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  previewTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 6,
  },
  scrollContent: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  payslipCard: {
    backgroundColor: COLORS.white,
    marginHorizontal: 8,
    marginTop: 12,
    marginBottom: -30,
    borderRadius: 6,
    paddingHorizontal: 24,
    paddingVertical: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    width: '97%',
    alignSelf: 'center',
    aspectRatio: 8.5 / 11,
  },
  previewHeaderWide: {
    backgroundColor: COLORS.white,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: -12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  companyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  companyInfo: {
    flex: 1,
    paddingRight: 16,
  },
  headerLogo: {
    width: 36,
    height: 36,
    marginBottom: 6,
  },
  companyTagline: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  companyDetails: {
    fontSize: 9,
    color: '#666',
    marginBottom: 1,
  },
  invoiceInfo: {
    alignItems: 'flex-end',
  },
  invoiceLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: '#333',
    marginBottom: 3,
  },
  invoiceNumber: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  dateText: {
    fontSize: 10,
    color: '#666',
    marginBottom: 2,
  },
  divider: {
    height: 2,
    backgroundColor: '#2196F3',
    marginVertical: 14,
  },
  payToSection: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: '#2196F3',
    borderRadius: 4,
    padding: 12,
    marginBottom: 16,
  },
  middleFields: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 40,
    marginBottom: 0,
  },
  middleFieldCol: {
    flex: 1,
  },
  middleFieldColRight: {
    flex: 0.6,
    alignItems: 'flex-end',
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#2196F3',
    letterSpacing: 0.3,
  },
  payToName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  tableSection: {
    marginBottom: 18,
  },
  tableContainer: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#FFF',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#F5F5F5',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableHeaderText: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  tableCell: {
    fontSize: 10,
    color: COLORS.text,
    textAlign: 'center',
  },
  paymentSection: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  totalAndPaidContainer: {
    width: '62%',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  totalSection: {
    width: '100%',
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  paidInfoBelowTotal: {
    alignItems: 'center',
  },
  paidDateBelowTotal: {
    marginTop: 12,
    color: '#4CAF50',
    fontSize: 12,
    fontWeight: '700',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  totalLabel: {
    fontSize: 12,
    color: '#666',
  },
  totalValue: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  finalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 10,
    borderTopWidth: 2,
    borderTopColor: '#000',
    marginTop: 6,
  },
  finalTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#000',
  },
  finalTotalValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#2196F3',
  },
  closeButton: {
    backgroundColor: '#E53935',
    marginHorizontal: 20,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.white,
  },
  statusTabs: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 28,
    gap: 8,
  },
  statusTab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 24,
    backgroundColor: '#E8E8E8',
  },
  activeTab: {
    backgroundColor: '#2196F3',
  },
  tabText: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  activeTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.white,
  },
  payslipList: {
    marginHorizontal: 20,
    marginTop: 20,
  },
  payslipListItem: {
    backgroundColor: COLORS.white,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  listItemLeft: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  listItemSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  listItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  viewButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  viewButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  paidBadge: {
    backgroundColor: '#4CAF50',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    gap: 4,
  },
  paidBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.white,
  },
  bottomPadding: {
    height: 40,
  },
  // paid stamp box removed; "PAID" text is rendered below totals.
});

export default PayslipComponent;
