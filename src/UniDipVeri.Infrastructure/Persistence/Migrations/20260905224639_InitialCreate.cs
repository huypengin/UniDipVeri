using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace UniDipVeri.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "universities",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    issuer_id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "ACTIVE"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_universities", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "programs",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    university_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    full_title = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    degree_level = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "BACHELOR"),
                    status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "ACTIVE"),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_programs", x => x.id);
                    table.ForeignKey(
                        name: "FK_programs_universities_university_id",
                        column: x => x.university_id,
                        principalTable: "universities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "university_staff",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    university_id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    role = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_university_staff", x => x.id);
                    table.ForeignKey(
                        name: "FK_university_staff_universities_university_id",
                        column: x => x.university_id,
                        principalTable: "universities",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "students",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    program_id = table.Column<Guid>(type: "uuid", nullable: false),
                    student_number = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    name = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    email = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    password_hash = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    account_status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "PENDING_ACTIVATION"),
                    graduation_status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false, defaultValue: "NOT_STARTED"),
                    source_record_ref = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: false),
                    wallet_id = table.Column<string>(type: "character varying(255)", maxLength: 255, nullable: true),
                    wallet_status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    imported_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_students", x => x.id);
                    table.ForeignKey(
                        name: "FK_students_programs_program_id",
                        column: x => x.program_id,
                        principalTable: "programs",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.InsertData(
                table: "universities",
                columns: new[] { "id", "code", "created_at", "issuer_id", "name", "updated_at" },
                values: new object[] { new Guid("11111111-1111-1111-1111-111111111111"), "MIU", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "did:web:miu.example", "Mekong International University", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.InsertData(
                table: "programs",
                columns: new[] { "id", "created_at", "full_title", "name", "university_id", "updated_at" },
                values: new object[] { new Guid("22222222-2222-2222-2222-222222222221"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Bachelor of Science in Computer Science", "Computer Science", new Guid("11111111-1111-1111-1111-111111111111"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.InsertData(
                table: "programs",
                columns: new[] { "id", "created_at", "degree_level", "full_title", "name", "university_id", "updated_at" },
                values: new object[] { new Guid("22222222-2222-2222-2222-222222222222"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "MASTER", "Master of Science in Software Engineering", "Software Engineering", new Guid("11111111-1111-1111-1111-111111111111"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) });

            migrationBuilder.InsertData(
                table: "university_staff",
                columns: new[] { "id", "created_at", "email", "name", "password_hash", "role", "status", "university_id", "updated_at" },
                values: new object[,]
                {
                    { new Guid("33333333-3333-3333-3333-333333333331"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "admin@staff.miu.example", "System Administrator", "sha256.600000.a7I238/7ec9pD3ZfmSr7yg==.ZqaSsZ2dnjnlRAFRgLq6RTdSmNGycU+DSsdxdmmufk0=", "ADMIN", "ACTIVE", new Guid("11111111-1111-1111-1111-111111111111"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) },
                    { new Guid("33333333-3333-3333-3333-333333333332"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "registrar@staff.miu.example", "Sarah Registrar", "sha256.600000.a7I238/7ec9pD3ZfmSr7yg==.ZqaSsZ2dnjnlRAFRgLq6RTdSmNGycU+DSsdxdmmufk0=", "REGISTRAR", "ACTIVE", new Guid("11111111-1111-1111-1111-111111111111"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) },
                    { new Guid("33333333-3333-3333-3333-333333333333"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "approver@staff.miu.example", "David Approver", "sha256.600000.a7I238/7ec9pD3ZfmSr7yg==.ZqaSsZ2dnjnlRAFRgLq6RTdSmNGycU+DSsdxdmmufk0=", "APPROVER", "ACTIVE", new Guid("11111111-1111-1111-1111-111111111111"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc) }
                });

            migrationBuilder.InsertData(
                table: "students",
                columns: new[] { "id", "account_status", "created_at", "email", "graduation_status", "imported_at", "name", "password_hash", "program_id", "source_record_ref", "student_number", "updated_at", "wallet_id", "wallet_status" },
                values: new object[] { new Guid("44444444-4444-4444-4444-444444444441"), "ACTIVE", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "student@student.miu.example", "ELIGIBLE", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Alice Nguyen", "sha256.600000.a7I238/7ec9pD3ZfmSr7yg==.ZqaSsZ2dnjnlRAFRgLq6RTdSmNGycU+DSsdxdmmufk0=", new Guid("22222222-2222-2222-2222-222222222221"), "SIS-2026-CS-001", "STU-2026-001", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "wallet_stu_001_alice", "ACTIVE" });

            migrationBuilder.InsertData(
                table: "students",
                columns: new[] { "id", "created_at", "email", "imported_at", "name", "password_hash", "program_id", "source_record_ref", "student_number", "updated_at", "wallet_id", "wallet_status" },
                values: new object[] { new Guid("44444444-4444-4444-4444-444444444442"), new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "bob.tran@student.miu.example", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), "Bob Tran", "", new Guid("22222222-2222-2222-2222-222222222221"), "SIS-2026-CS-002", "STU-2026-002", new DateTime(2026, 1, 1, 0, 0, 0, 0, DateTimeKind.Utc), null, "PENDING" });

            migrationBuilder.CreateIndex(
                name: "IX_programs_university_id",
                table: "programs",
                column: "university_id");

            migrationBuilder.CreateIndex(
                name: "IX_students_email",
                table: "students",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_students_program_id",
                table: "students",
                column: "program_id");

            migrationBuilder.CreateIndex(
                name: "IX_students_student_number",
                table: "students",
                column: "student_number",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_universities_code",
                table: "universities",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_university_staff_email",
                table: "university_staff",
                column: "email",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_university_staff_university_id",
                table: "university_staff",
                column: "university_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "students");

            migrationBuilder.DropTable(
                name: "university_staff");

            migrationBuilder.DropTable(
                name: "programs");

            migrationBuilder.DropTable(
                name: "universities");
        }
    }
}
