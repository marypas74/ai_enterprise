import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { findOne, findAll, insertOne, updateOne } from '../../database/index.js';
import { requireAdmin } from '../../middleware/index.js';

// Types
interface Skill {
  id: number;
  name: string;
  display_name: string;
  description: string;
  category: string;
  system_prompt: string;
  example_prompts: string;
  required_tools: string;
  is_default: boolean;
  is_active: boolean;
}

interface UserSkill {
  user_id: number;
  skill_id: number;
  is_enabled: boolean;
  proficiency_level: string;
  custom_prompt_addition: string;
}

interface SkillTemplate {
  id: number;
  name: string;
  display_name: string;
  description: string;
  skill_ids: string;
  is_active: boolean;
}

// Validation schemas
const createSkillSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.enum(['coding', 'writing', 'analysis', 'research', 'creative', 'technical', 'communication', 'other']).default('other'),
  system_prompt: z.string().optional(),
  example_prompts: z.array(z.string()).optional(),
  required_tools: z.array(z.number()).optional(),
  is_default: z.boolean().default(false),
  is_active: z.boolean().default(true)
});

const updateSkillSchema = createSkillSchema.partial();

const userSkillSchema = z.object({
  is_enabled: z.boolean().default(true),
  proficiency_level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).default('intermediate'),
  custom_prompt_addition: z.string().optional()
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  display_name: z.string().min(1).max(200),
  description: z.string().optional(),
  skill_ids: z.array(z.number()),
  is_active: z.boolean().default(true)
});

export async function skillRoutes(fastify: FastifyInstance) {

  // ==========================================
  // SKILLS MANAGEMENT (Admin)
  // ==========================================

  // Get all skills
  fastify.get('/skills', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get all available skills',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { role: string };
    const isAdmin = user.role === 'admin';

    const skills = await findAll<Skill>(
      fastify.db,
      isAdmin
        ? 'SELECT * FROM skills ORDER BY category, display_name'
        : 'SELECT * FROM skills WHERE is_active = TRUE ORDER BY category, display_name'
    );

    // Parse JSON fields
    return skills.map(s => ({
      ...s,
      example_prompts: s.example_prompts ? JSON.parse(s.example_prompts) : [],
      required_tools: s.required_tools ? JSON.parse(s.required_tools) : []
    }));
  });

  // Get single skill
  fastify.get('/skills/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get skill details',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    const skill = await findOne<Skill>(
      fastify.db,
      'SELECT * FROM skills WHERE id = ?',
      [id]
    );

    if (!skill) {
      return reply.status(404).send({ error: 'Skill not found' });
    }

    // Get user count using this skill
    const [{ count }] = await findAll<{ count: number }>(
      fastify.db,
      'SELECT COUNT(*) as count FROM user_skills WHERE skill_id = ? AND is_enabled = TRUE',
      [id]
    );

    return {
      ...skill,
      example_prompts: skill.example_prompts ? JSON.parse(skill.example_prompts) : [],
      required_tools: skill.required_tools ? JSON.parse(skill.required_tools) : [],
      user_count: count
    };
  });

  // Create skill (Admin only)
  fastify.post('/skills', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Create new skill',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createSkillSchema.parse(request.body);

    // Use upsert to handle re-installation of existing skills gracefully
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const [upsertResult]: any = await fastify.db.execute(
      `INSERT INTO skills (name, display_name, description, category, system_prompt, example_prompts, required_tools, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         description = VALUES(description),
         category = VALUES(category),
         system_prompt = VALUES(system_prompt),
         example_prompts = VALUES(example_prompts),
         required_tools = VALUES(required_tools),
         is_default = VALUES(is_default),
         is_active = VALUES(is_active)`,
      [
        body.name,
        body.display_name,
        body.description || null,
        body.category,
        body.system_prompt || null,
        body.example_prompts ? JSON.stringify(body.example_prompts) : null,
        body.required_tools ? JSON.stringify(body.required_tools) : null,
        body.is_default,
        body.is_active
      ]
    );
    // insertId is 0 on update, so fetch the existing id
    let skillId = upsertResult.insertId;
    if (!skillId) {
      const existing = await findOne<{ id: number }>(fastify.db,
        'SELECT id FROM skills WHERE name = ?', [body.name]);
      skillId = existing!.id;
    }

    // If default, assign to all existing users (ignore duplicates)
    if (body.is_default) {
      await fastify.db.execute(
        `INSERT IGNORE INTO user_skills (user_id, skill_id, is_enabled, proficiency_level)
         SELECT id, ?, TRUE, 'intermediate' FROM users`,
        [skillId]
      );
    }

    return { id: skillId, ...body };
  });

  // Update skill (Admin only)
  fastify.patch('/skills/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Update skill',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;
    const body = updateSkillSchema.parse(request.body);

    const updates: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        if (key === 'example_prompts' || key === 'required_tools') {
          updates.push(`${key} = ?`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${key} = ?`);
          values.push(value);
        }
      }
    }

    if (updates.length > 0) {
      values.push(id);
      await updateOne(
        fastify.db,
        `UPDATE skills SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }

    return { success: true };
  });

  // Delete skill (Admin only)
  fastify.delete('/skills/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Delete skill',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM skills WHERE id = ?', [id]);

    return { success: true };
  });

  // ==========================================
  // USER SKILLS (Current user)
  // ==========================================

  // Get current user's skills
  fastify.get('/user/skills', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get current user skills',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const skills = await findAll<any>(
      fastify.db,
      `SELECT s.*, us.is_enabled, us.proficiency_level, us.custom_prompt_addition
       FROM skills s
       LEFT JOIN user_skills us ON s.id = us.skill_id AND us.user_id = ?
       WHERE s.is_active = TRUE
       ORDER BY s.category, s.display_name`,
      [userId]
    );

    return skills.map(s => ({
      ...s,
      example_prompts: s.example_prompts ? JSON.parse(s.example_prompts) : [],
      required_tools: s.required_tools ? JSON.parse(s.required_tools) : [],
      is_enabled: s.is_enabled ?? false,
      proficiency_level: s.proficiency_level ?? 'intermediate'
    }));
  });

  // Update user skill
  fastify.put('/user/skills/:skillId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Enable/configure skill for current user',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { skillId } = request.params;
    const body = userSkillSchema.parse(request.body);

    await fastify.db.execute(
      `INSERT INTO user_skills (user_id, skill_id, is_enabled, proficiency_level, custom_prompt_addition)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = ?, proficiency_level = ?, custom_prompt_addition = ?`,
      [
        userId, skillId, body.is_enabled, body.proficiency_level, body.custom_prompt_addition || null,
        body.is_enabled, body.proficiency_level, body.custom_prompt_addition || null
      ]
    );

    return { success: true };
  });

  // Disable skill for user
  fastify.delete('/user/skills/:skillId', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Disable skill for current user',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { skillId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { skillId } = request.params;

    await fastify.db.execute(
      'UPDATE user_skills SET is_enabled = FALSE WHERE user_id = ? AND skill_id = ?',
      [userId, skillId]
    );

    return { success: true };
  });

  // ==========================================
  // ADMIN: USER SKILLS MANAGEMENT
  // ==========================================

  // Get specific user's skills (Admin only)
  fastify.get('/users/:userId/skills', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Get user skills (admin)',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const { userId } = request.params;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const skills = await findAll<any>(
      fastify.db,
      `SELECT s.*, us.is_enabled, us.proficiency_level, us.custom_prompt_addition
       FROM skills s
       LEFT JOIN user_skills us ON s.id = us.skill_id AND us.user_id = ?
       ORDER BY s.category, s.display_name`,
      [userId]
    );

    return skills.map(s => ({
      ...s,
      example_prompts: s.example_prompts ? JSON.parse(s.example_prompts) : [],
      required_tools: s.required_tools ? JSON.parse(s.required_tools) : [],
      is_enabled: s.is_enabled ?? false,
      proficiency_level: s.proficiency_level ?? 'intermediate'
    }));
  });

  // Set user skills (Admin only)
  fastify.put('/users/:userId/skills', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Set user skills (admin)',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
    const { userId } = request.params;
    const skills = z.array(z.object({
      skill_id: z.number(),
      is_enabled: z.boolean(),
      proficiency_level: z.enum(['beginner', 'intermediate', 'advanced', 'expert']).default('intermediate')
    })).parse(request.body);

    // Delete existing and insert new
    await fastify.db.execute('DELETE FROM user_skills WHERE user_id = ?', [userId]);

    for (const skill of skills) {
      if (skill.is_enabled) {
        await insertOne(
          fastify.db,
          'INSERT INTO user_skills (user_id, skill_id, is_enabled, proficiency_level) VALUES (?, ?, ?, ?)',
          [userId, skill.skill_id, skill.is_enabled, skill.proficiency_level]
        );
      }
    }

    return { success: true, count: skills.filter(s => s.is_enabled).length };
  });

  // ==========================================
  // SKILL TEMPLATES
  // ==========================================

  // Get all templates
  fastify.get('/skill-templates', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Get skill templates',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const templates = await findAll<SkillTemplate>(
      fastify.db,
      'SELECT * FROM skill_templates WHERE is_active = TRUE ORDER BY display_name'
    );

    return templates.map(t => ({
      ...t,
      skill_ids: t.skill_ids ? JSON.parse(t.skill_ids) : []
    }));
  });

  // Apply template to current user
  fastify.post('/user/skill-templates/:templateId/apply', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate],
    schema: {
      description: 'Apply skill template to current user',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { templateId: string } }>, reply: FastifyReply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const userId = (request.user as any).id;
    const { templateId } = request.params;

    const template = await findOne<SkillTemplate>(
      fastify.db,
      'SELECT * FROM skill_templates WHERE id = ?',
      [templateId]
    );

    if (!template) {
      return reply.status(404).send({ error: 'Template not found' });
    }

    const skillIds = JSON.parse(template.skill_ids);

    // Enable skills from template
    for (const skillId of skillIds) {
      await fastify.db.execute(
        `INSERT INTO user_skills (user_id, skill_id, is_enabled, proficiency_level)
         VALUES (?, ?, TRUE, 'intermediate')
         ON DUPLICATE KEY UPDATE is_enabled = TRUE`,
        [userId, skillId]
      );
    }

    return { success: true, skills_enabled: skillIds.length };
  });

  // Create template (Admin only)
  fastify.post('/skill-templates', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Create skill template',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = createTemplateSchema.parse(request.body);

    const templateId = await insertOne(
      fastify.db,
      'INSERT INTO skill_templates (name, display_name, description, skill_ids, is_active) VALUES (?, ?, ?, ?, ?)',
      [body.name, body.display_name, body.description || null, JSON.stringify(body.skill_ids), body.is_active]
    );

    return { id: templateId, ...body };
  });

  // Delete template (Admin only)
  fastify.delete('/skill-templates/:id', {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    onRequest: [(fastify as any).authenticate, requireAdmin],
    schema: {
      description: 'Delete skill template',
      tags: ['skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = request.params;

    await fastify.db.execute('DELETE FROM skill_templates WHERE id = ?', [id]);

    return { success: true };
  });
}
