-- Reduce the schema to the specification's scope: 87 tables -> 53.
--
-- The upstream project is an Indian dental SaaS; this installation is a single
-- clinic. Most of what is dropped here is either the vendor's own machinery
-- (subscription billing, marketing automation, loyalty programmes) or features
-- that appear nowhere in the specification.
--
-- Grouped by why, not by table:
--
--   Unreachable code. Account, Session and VerificationToken are NextAuth
--   adapter tables, but no adapter is configured and the session strategy is
--   JWT, so nothing could ever read or write them. Subscription and
--   SubscriptionPayment bill a clinic for using the software; this clinic owns
--   its installation.
--
--   Specification SS3, "Out of Scope for Initial Release": "Full payroll,
--   attendance, or enterprise HR management beyond basic user/staff profiles"
--   removes Attendance and Leave.
--
--   Absent from the specification entirely: loyalty points, membership plans,
--   a referral programme (SS5.1 asks for a referral *source*, which
--   Patient.referredBy already is), marketing automation, patient surveys, a
--   sterilisation register, IoT device telemetry, tele-dentistry, mobile push
--   and Google Calendar sync.
--
--   Specification SS16 lists the patient portal, insurance and AI-assisted
--   admin as future enhancements. They are dropped rather than carried: when
--   they are built they should be designed against this clinic's requirements,
--   not inherited from an Indian SaaS's shape.
--
--   Online payment. Razorpay, PhonePe and Paytm onboard Indian merchants only,
--   so none of this worked here. A Pakistani processor needs a different shape,
--   so there was nothing to reuse.
--
-- This is irreversible and it discards data. On this installation those tables
-- hold only seed fixtures. Anywhere else, take a backup first: the schema
-- before this migration is in git at the preceding commit.

-- DropForeignKey
ALTER TABLE "AIConversation" DROP CONSTRAINT "AIConversation_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "AIConversation" DROP CONSTRAINT "AIConversation_userId_fkey";

-- DropForeignKey
ALTER TABLE "AIInsight" DROP CONSTRAINT "AIInsight_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "AISkillExecution" DROP CONSTRAINT "AISkillExecution_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_userId_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "Attendance" DROP CONSTRAINT "Attendance_staffId_fkey";

-- DropForeignKey
ALTER TABLE "CalendarIntegration" DROP CONSTRAINT "CalendarIntegration_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "CalendarIntegration" DROP CONSTRAINT "CalendarIntegration_userId_fkey";

-- DropForeignKey
ALTER TABLE "Device" DROP CONSTRAINT "Device_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "DeviceDataLog" DROP CONSTRAINT "DeviceDataLog_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "Instrument" DROP CONSTRAINT "Instrument_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "InsuranceClaim" DROP CONSTRAINT "InsuranceClaim_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "InsuranceClaim" DROP CONSTRAINT "InsuranceClaim_patientId_fkey";

-- DropForeignKey
ALTER TABLE "InsuranceProviderMaster" DROP CONSTRAINT "InsuranceProviderMaster_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_insuranceClaimId_fkey";

-- DropForeignKey
ALTER TABLE "Leave" DROP CONSTRAINT "Leave_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "Leave" DROP CONSTRAINT "Leave_staffId_fkey";

-- DropForeignKey
ALTER TABLE "LoyaltyTransaction" DROP CONSTRAINT "LoyaltyTransaction_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "MarketingAutomation" DROP CONSTRAINT "MarketingAutomation_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "MembershipPlan" DROP CONSTRAINT "MembershipPlan_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PatientInsurance" DROP CONSTRAINT "PatientInsurance_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PatientInsurance" DROP CONSTRAINT "PatientInsurance_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PatientInsurance" DROP CONSTRAINT "PatientInsurance_providerId_fkey";

-- DropForeignKey
ALTER TABLE "PatientMembership" DROP CONSTRAINT "PatientMembership_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PatientMembership" DROP CONSTRAINT "PatientMembership_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PatientMembership" DROP CONSTRAINT "PatientMembership_planId_fkey";

-- DropForeignKey
ALTER TABLE "PatientOTP" DROP CONSTRAINT "PatientOTP_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PatientRiskScore" DROP CONSTRAINT "PatientRiskScore_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PatientRiskScore" DROP CONSTRAINT "PatientRiskScore_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentGatewayConfig" DROP CONSTRAINT "PaymentGatewayConfig_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentLink" DROP CONSTRAINT "PaymentLink_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentLink" DROP CONSTRAINT "PaymentLink_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentPlan" DROP CONSTRAINT "PaymentPlan_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentPlan" DROP CONSTRAINT "PaymentPlan_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentPlan" DROP CONSTRAINT "PaymentPlan_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PaymentPlanSchedule" DROP CONSTRAINT "PaymentPlanSchedule_planId_fkey";

-- DropForeignKey
ALTER TABLE "PreAuthorization" DROP CONSTRAINT "PreAuthorization_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PreAuthorization" DROP CONSTRAINT "PreAuthorization_insurancePolicyId_fkey";

-- DropForeignKey
ALTER TABLE "PreAuthorization" DROP CONSTRAINT "PreAuthorization_patientId_fkey";

-- DropForeignKey
ALTER TABLE "PushDevice" DROP CONSTRAINT "PushDevice_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "PushDevice" DROP CONSTRAINT "PushDevice_userId_fkey";

-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropForeignKey
ALTER TABLE "SterilizationLog" DROP CONSTRAINT "SterilizationLog_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "SterilizationLog" DROP CONSTRAINT "SterilizationLog_instrumentId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "SubscriptionPayment" DROP CONSTRAINT "SubscriptionPayment_subscriptionId_fkey";

-- DropForeignKey
ALTER TABLE "Survey" DROP CONSTRAINT "Survey_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "SurveyResponse" DROP CONSTRAINT "SurveyResponse_surveyId_fkey";

-- DropForeignKey
ALTER TABLE "VideoConsultation" DROP CONSTRAINT "VideoConsultation_appointmentId_fkey";

-- DropForeignKey
ALTER TABLE "VideoConsultation" DROP CONSTRAINT "VideoConsultation_doctorId_fkey";

-- DropForeignKey
ALTER TABLE "VideoConsultation" DROP CONSTRAINT "VideoConsultation_hospitalId_fkey";

-- DropForeignKey
ALTER TABLE "VideoConsultation" DROP CONSTRAINT "VideoConsultation_patientId_fkey";

-- AlterTable
ALTER TABLE "Appointment" DROP COLUMN "isVirtual",
DROP COLUMN "videoConsultationId";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "insuranceClaimId";

-- DropTable
DROP TABLE "AIConversation";

-- DropTable
DROP TABLE "AIInsight";

-- DropTable
DROP TABLE "AISkillExecution";

-- DropTable
DROP TABLE "Account";

-- DropTable
DROP TABLE "Attendance";

-- DropTable
DROP TABLE "CalendarIntegration";

-- DropTable
DROP TABLE "Device";

-- DropTable
DROP TABLE "DeviceDataLog";

-- DropTable
DROP TABLE "Instrument";

-- DropTable
DROP TABLE "InsuranceClaim";

-- DropTable
DROP TABLE "InsuranceProviderMaster";

-- DropTable
DROP TABLE "Leave";

-- DropTable
DROP TABLE "LoyaltyTransaction";

-- DropTable
DROP TABLE "MarketingAutomation";

-- DropTable
DROP TABLE "MembershipPlan";

-- DropTable
DROP TABLE "PatientInsurance";

-- DropTable
DROP TABLE "PatientMembership";

-- DropTable
DROP TABLE "PatientOTP";

-- DropTable
DROP TABLE "PatientRiskScore";

-- DropTable
DROP TABLE "PaymentGatewayConfig";

-- DropTable
DROP TABLE "PaymentLink";

-- DropTable
DROP TABLE "PaymentPlan";

-- DropTable
DROP TABLE "PaymentPlanSchedule";

-- DropTable
DROP TABLE "PreAuthorization";

-- DropTable
DROP TABLE "PushDevice";

-- DropTable
DROP TABLE "Referral";

-- DropTable
DROP TABLE "Session";

-- DropTable
DROP TABLE "SterilizationLog";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "SubscriptionPayment";

-- DropTable
DROP TABLE "Survey";

-- DropTable
DROP TABLE "SurveyResponse";

-- DropTable
DROP TABLE "VerificationToken";

-- DropTable
DROP TABLE "VideoConsultation";

-- DropEnum
DROP TYPE "AIExecutionStatus";

-- DropEnum
DROP TYPE "AIInsightCategory";

-- DropEnum
DROP TYPE "AISessionType";

-- DropEnum
DROP TYPE "AttendanceStatus";

-- DropEnum
DROP TYPE "ConsultationStatus";

-- DropEnum
DROP TYPE "DeviceStatus";

-- DropEnum
DROP TYPE "InsightSeverity";

-- DropEnum
DROP TYPE "InstallmentStatus";

-- DropEnum
DROP TYPE "InstrumentStatus";

-- DropEnum
DROP TYPE "InsuranceClaimStatus";

-- DropEnum
DROP TYPE "LeaveStatus";

-- DropEnum
DROP TYPE "LeaveType";

-- DropEnum
DROP TYPE "MembershipStatus";

-- DropEnum
DROP TYPE "PaymentPlanStatus";

-- DropEnum
DROP TYPE "PaymentProvider";

-- DropEnum
DROP TYPE "PlanFrequency";

-- DropEnum
DROP TYPE "PreAuthStatus";

-- DropEnum
DROP TYPE "ReferralStatus";

-- DropEnum
DROP TYPE "SterilizationResult";

-- DropEnum
DROP TYPE "SubscriptionPaymentStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";

-- DropEnum
DROP TYPE "SurveyTrigger";

-- DropEnum
DROP TYPE "SurveyType";

