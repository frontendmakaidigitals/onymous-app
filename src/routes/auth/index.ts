import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { DEVICE_COOKIE, issueSession, recognize } from "@/lib/fingerprint/recognize";

const shop = z.string().trim().min(1).max(255);

const recognizeBody = z.object({ shop, fpRequestId: z.string().optional() });

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/recognize", async (req, reply) => {
    const body = recognizeBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const match = await recognize({
      cookie: req.cookies[DEVICE_COOKIE],
      ...(body.data.fpRequestId ? { fpRequestId: body.data.fpRequestId } : {}),
    });
    if (!match) return { recognized: false };

    const token = await issueSession(match, body.data.shop);
    return { recognized: true, token, firstName: match.firstName, via: match.via };
  });
};

export default authRoutes;
