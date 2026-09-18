import { SESClient, SendEmailCommand, SendRawEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "./logger.js";

// Email configuration - optional for development
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const EMAIL_ENABLED = !!SES_FROM_EMAIL;

let sesClient: SESClient | null = null;
if (EMAIL_ENABLED) {
  sesClient = new SESClient({ region: AWS_REGION });
}

export interface EmailOptions {
  to: string;
  cc?: string[];
  subject: string;
  htmlBody: string;
  attachment?: {
    filename: string;
    content: Buffer; // PDF or other binary content
    contentType: string;
  };
}

export async function sendEmail(options: EmailOptions): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
}> {
  // If email is disabled, return success (mock mode)
  if (!EMAIL_ENABLED) {
    logger.warn(
      { to: options.to, subject: options.subject },
      "Email service disabled - email not sent (set SES_FROM_EMAIL to enable)"
    );
    return {
      success: true,
      messageId: "mock-" + Date.now(),
    };
  }

  try {
    const toAddresses = [options.to];
    const ccAddresses = options.cc && options.cc.length > 0 ? options.cc : [];

    if (options.attachment) {
      return await sendRawEmailWithAttachment(
        options.to,
        ccAddresses,
        options.subject,
        options.htmlBody,
        options.attachment
      );
    }

    const command = new SendEmailCommand({
      Source: SES_FROM_EMAIL!,
      Destination: {
        ToAddresses: toAddresses,
        CcAddresses: ccAddresses.length > 0 ? ccAddresses : undefined,
      },
      Message: {
        Subject: { Data: options.subject },
        Body: {
          Html: { Data: options.htmlBody },
        },
      },
    });

    const response = await sesClient!.send(command);
    logger.info(
      { messageId: response.MessageId, to: options.to },
      "Email sent successfully"
    );

    return {
      success: true,
      messageId: response.MessageId,
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    logger.error(
      { error: errorMessage, to: options.to },
      "Failed to send email"
    );
    return {
      success: false,
      error: errorMessage,
    };
  }
}

async function sendRawEmailWithAttachment(
  to: string,
  cc: string[],
  subject: string,
  htmlBody: string,
  attachment: { filename: string; content: Buffer; contentType: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  // If email is disabled, return success (mock mode)
  if (!EMAIL_ENABLED) {
    logger.warn(
      { to, subject, attachment: attachment.filename },
      "Email service disabled - email with attachment not sent"
    );
    return {
      success: true,
      messageId: "mock-" + Date.now(),
    };
  }

  try {
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const base64Content = attachment.content.toString("base64");

    const rawMimeLines = [
      `From: ${SES_FROM_EMAIL!}`,
      `To: ${to}`,
      ...(cc.length > 0 ? [`Cc: ${cc.join(", ")}`] : []),
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 7bit`,
      ``,
      htmlBody,
      ``,
      `--${boundary}`,
      `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
      `Content-Description: ${attachment.filename}`,
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      base64Content,
      ``,
      `--${boundary}--`,
    ];

    const rawMessageBuffer = Buffer.from(rawMimeLines.join("\r\n"));

    const command = new SendRawEmailCommand({
      RawMessage: {
        Data: rawMessageBuffer,
      },
    });

    const response = await sesClient!.send(command);

    logger.info(
      { messageId: response.MessageId, to },
      "Raw email with attachment sent successfully"
    );

    return {
      success: true,
      messageId: response.MessageId,
    };
  } catch (error: any) {
    const errorMessage = error?.message || String(error);
    logger.error({ error: errorMessage, to }, "Failed to send raw email with attachment");
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export { SES_FROM_EMAIL, EMAIL_ENABLED };

