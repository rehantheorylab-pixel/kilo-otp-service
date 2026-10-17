const { ImapFlow } = require('imapflow');

const GMAIL_USER = process.env.GMAIL_USER || 'rehan.facemuse@gmail.com';
const GMAIL_APP_PASS = process.env.GMAIL_APP_PASS || 'nfzurikrtjitfmyx';

exports.handler = async function(event, context) {
    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };

    if (event.httpMethod === "OPTIONS") {
        return { statusCode: 200, headers, body: "" };
    }

    const tag = (event.queryStringParameters && event.queryStringParameters.tag || "").trim();
    if (!tag) {
        return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ success: false, error: "Missing required 'tag' query parameter." })
        };
    }

    const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: {
            user: GMAIL_USER,
            pass: GMAIL_APP_PASS
        },
        logger: false
    });

    let foundOtp = null;
    let targetUid = null;

    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');

        try {
            const total = client.mailbox.exists;
            if (total > 0) {
                // Fetch the latest 12 messages
                const startSeq = Math.max(1, total - 11);
                const range = `${startSeq}:${total}`;

                // Fetch envelope, headers, and body source
                for await (let msg of client.fetch(range, { envelope: true, bodyStructure: true, source: true })) {
                    const toText = JSON.stringify(msg.envelope.to || []) + " " + (msg.envelope.subject || "");
                    const rawSource = msg.source ? msg.source.toString('utf-8') : '';

                    if (toText.includes(tag) || rawSource.includes(tag)) {
                        // Clean HTML
                        const cleanText = rawSource.replace(/<[^>]+>/g, ' ');
                        
                        // Extract 6-digit code
                        const m = cleanText.match(/(?:verification\s*code|code\s*is|your\s*code|verification)[^\d]{0,25}(\d{6})/i) 
                               || cleanText.match(/\b(\d{6})\b/);

                        if (m) {
                            foundOtp = m[1];
                            targetUid = msg.uid;
                            break;
                        }
                    }
                }

                // Delete target email to keep inbox empty
                if (foundOtp && targetUid) {
                    try {
                        await client.messageDelete(targetUid);
                    } catch (e) {}
                }
            }
        } finally {
            lock.release();
        }

        await client.logout();

        if (foundOtp) {
            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, otp: foundOtp, tag: tag })
            };
        } else {
            return {
                statusCode: 404,
                headers,
                body: JSON.stringify({ success: false, message: `No email found yet for tag: ${tag}` })
            };
        }

    } catch (err) {
        try { await client.logout(); } catch (e) {}
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ success: false, error: err.message })
        };
    }
};
