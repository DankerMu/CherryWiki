ALTER TABLE retrieval_traces
  DROP CONSTRAINT retrieval_traces_conversation_id_fkey,
  ADD CONSTRAINT retrieval_traces_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE model_usage_logs
  DROP CONSTRAINT model_usage_logs_conversation_id_fkey,
  ADD CONSTRAINT model_usage_logs_conversation_id_fkey
    FOREIGN KEY (conversation_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE feedback_items
  DROP CONSTRAINT feedback_items_message_id_chat_messages_id_fk,
  ADD CONSTRAINT feedback_items_message_id_chat_messages_id_fk
    FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE;

-- Rollback: revert to NO ACTION
-- ALTER TABLE retrieval_traces DROP CONSTRAINT retrieval_traces_conversation_id_fkey, ADD CONSTRAINT retrieval_traces_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_sessions(id);
-- ALTER TABLE model_usage_logs DROP CONSTRAINT model_usage_logs_conversation_id_fkey, ADD CONSTRAINT model_usage_logs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES chat_sessions(id);
-- ALTER TABLE feedback_items DROP CONSTRAINT feedback_items_message_id_chat_messages_id_fk, ADD CONSTRAINT feedback_items_message_id_chat_messages_id_fk FOREIGN KEY (message_id) REFERENCES chat_messages(id);
