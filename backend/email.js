const nodemailer = require('nodemailer');

const notificationAddress = 'info@nexotictech.com';

function getTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.hostinger.com';
  const port = Number(process.env.SMTP_PORT) || 465;
  const secure = process.env.SMTP_SECURE === undefined ? port === 465 : process.env.SMTP_SECURE === 'true';

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP credentials are not configured.');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendContactNotification(submission) {
  const fields = [
    ['Visitor name', submission.name],
    ['Visitor email', submission.email],
    ['Phone', submission.phone || 'Not provided'],
    ['Company', submission.company || 'Not provided'],
    ['Requested service', submission.service],
    ['Budget', submission.budget || 'Not provided'],
    ['Project description', submission.description],
    ['Submission date/time', submission.createdAt]
  ];

  await getTransporter().sendMail({
    from: process.env.SMTP_USER,
    to: notificationAddress,
    replyTo: submission.email,
    subject: 'New Website Enquiry — Nexotic Tech',
    text: fields.map(([label, value]) => `${label}: ${value}`).join('\n')
  });
}

module.exports = { sendContactNotification };
